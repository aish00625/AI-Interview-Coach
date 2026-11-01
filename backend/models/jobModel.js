const { pool } = require('../config/db')

/**
 * Job openings + required skills (Phase B).
 *
 * Authorization model: every hirer-facing function takes `organizationId`
 * (taken from req.organization, never from the request body/params) and
 * filters on it in SQL, so a job that belongs to another organization is
 * simply "not found". Candidate-facing functions only ever return jobs that
 * are open, unexpired AND owned by an APPROVED organization.
 */

const SKILLS_JSON = `
  COALESCE((
    SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'mandatory', jrs.is_mandatory) ORDER BY s.name)
      FROM job_required_skills jrs JOIN skills s ON s.id = jrs.skill_id
     WHERE jrs.job_id = j.id
  ), '[]'::json) AS required_skills`

const JOB_COLUMNS = `j.id, j.organization_id, j.title, j.description, j.location, j.employment_type,
       j.experience_level, j.eligibility_criteria, j.closes_at, j.status, j.published_at,
       j.created_at, j.updated_at, j.blind_review`
// Hirer-only extras. scorecard_criteria is never selected by candidate-facing queries.
const HIRER_EXTRA = ', j.scorecard_criteria'

async function createJob({ organizationId, createdBy, title, description, location, employmentType, experienceLevel, eligibilityCriteria, closesAt, blindReview, scorecardCriteria }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO job_openings (organization_id, created_by, title, description, location, employment_type, experience_level, eligibility_criteria, closes_at, blind_review, scorecard_criteria)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'full_time'), COALESCE($7, 'any'), $8, $9, COALESCE($10::boolean, FALSE), $11::jsonb)
     RETURNING id`,
    [organizationId, createdBy, title, description, location ?? null, employmentType ?? null, experienceLevel ?? null, eligibilityCriteria ?? null, closesAt ?? null,
      blindReview ?? null, scorecardCriteria ? JSON.stringify(scorecardCriteria) : null],
  )
  return rows[0].id
}

/** Returns null if the job doesn't exist OR belongs to another organization. */
async function updateJob(id, organizationId, fields, client = pool) {
  const { rows } = await client.query(
    `UPDATE job_openings
        SET title = COALESCE($3, title),
            description = COALESCE($4, description),
            location = CASE WHEN $10::boolean THEN $5 ELSE location END,
            employment_type = COALESCE($6, employment_type),
            experience_level = COALESCE($7, experience_level),
            eligibility_criteria = CASE WHEN $11::boolean THEN $8 ELSE eligibility_criteria END,
            closes_at = CASE WHEN $12::boolean THEN $9 ELSE closes_at END,
            blind_review = COALESCE($13::boolean, blind_review),
            scorecard_criteria = CASE WHEN $14::boolean THEN $15::jsonb ELSE scorecard_criteria END
      WHERE id = $1 AND organization_id = $2
      RETURNING id`,
    [
      id, organizationId,
      fields.title ?? null, fields.description ?? null,
      fields.location ?? null, fields.employmentType ?? null, fields.experienceLevel ?? null,
      fields.eligibilityCriteria ?? null, fields.closesAt ?? null,
      'location' in fields, 'eligibilityCriteria' in fields, 'closesAt' in fields,
      fields.blindReview ?? null, 'scorecardCriteria' in fields, fields.scorecardCriteria ? JSON.stringify(fields.scorecardCriteria) : null,
    ],
  )
  return rows[0] ? rows[0].id : null
}

/** Replaces the job's required skills. `skills` = [{ skillId, mandatory }]. */
async function replaceJobSkills(jobId, skills, client = pool) {
  await client.query('DELETE FROM job_required_skills WHERE job_id = $1', [jobId])
  for (const s of skills) {
    await client.query(
      'INSERT INTO job_required_skills (job_id, skill_id, is_mandatory) VALUES ($1, $2, $3) ON CONFLICT (job_id, skill_id) DO UPDATE SET is_mandatory = EXCLUDED.is_mandatory',
      [jobId, s.skillId, s.mandatory !== false],
    )
  }
}

async function getJobForOrg(id, organizationId) {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS}${HIRER_EXTRA}, ${SKILLS_JSON}
       FROM job_openings j
      WHERE j.id = $1 AND j.organization_id = $2`,
    [id, organizationId],
  )
  return rows[0] || null
}

async function listJobsForOrg(organizationId, { status = null } = {}) {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS}${HIRER_EXTRA}, ${SKILLS_JSON}
       FROM job_openings j
      WHERE j.organization_id = $1 AND ($2::text IS NULL OR j.status = $2)
      ORDER BY j.created_at DESC, j.id DESC`,
    [organizationId, status],
  )
  return rows
}

/** Returns the updated row or null (not found / other organization). */
async function setJobStatus(id, organizationId, status) {
  const { rows } = await pool.query(
    `UPDATE job_openings
        SET status = $3::text,
            published_at = CASE WHEN $3::text = 'open' AND published_at IS NULL THEN now() ELSE published_at END
      WHERE id = $1 AND organization_id = $2
      RETURNING id, status, published_at`,
    [id, organizationId, status],
  )
  return rows[0] || null
}

/** Deletes only a DRAFT job of this organization. Returns true if a row was deleted. */
async function deleteDraftJob(id, organizationId) {
  const { rows } = await pool.query(
    `DELETE FROM job_openings WHERE id = $1 AND organization_id = $2 AND status = 'draft' RETURNING id`,
    [id, organizationId],
  )
  return rows.length > 0
}

/* ------------------------ candidate-facing ------------------------ */

const OPEN_JOB_FILTER = `j.status = 'open'
       AND (j.closes_at IS NULL OR j.closes_at > now())
       AND o.status = 'approved'`

async function listOpenJobs({ search = null, limit = 20, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS}, o.name AS organization_name, ${SKILLS_JSON}
       FROM job_openings j
       JOIN organizations o ON o.id = j.organization_id
      WHERE ${OPEN_JOB_FILTER}
        AND ($1::text IS NULL OR j.title ILIKE '%' || $1 || '%' OR o.name ILIKE '%' || $1 || '%')
      ORDER BY j.published_at DESC NULLS LAST, j.id DESC
      LIMIT $2 OFFSET $3`,
    [search, limit, offset],
  )
  return rows
}

async function getOpenJob(id, client = pool) {
  const { rows } = await client.query(
    `SELECT ${JOB_COLUMNS}, o.name AS organization_name, ${SKILLS_JSON}
       FROM job_openings j
       JOIN organizations o ON o.id = j.organization_id
      WHERE j.id = $1 AND ${OPEN_JOB_FILTER}`,
    [id],
  )
  return rows[0] || null
}

/** Internal: job title for an application the caller has ALREADY been authorized for. Not exposed via any route. */
async function getJobForOrgless(id) {
  const { rows } = await pool.query('SELECT id, title, organization_id FROM job_openings WHERE id = $1', [id])
  return rows[0] || null
}

module.exports = {
  getJobForOrgless,
  createJob, updateJob, replaceJobSkills, getJobForOrg, listJobsForOrg, setJobStatus, deleteDraftJob,
  listOpenJobs, getOpenJob,
}
