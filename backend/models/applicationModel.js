const { pool } = require('../config/db')

/**
 * Applications (Phase C). Candidate-facing reads are always scoped by candidate_id in SQL.
 * Hirer-facing reads (Phase E) are scoped through job_openings.organization_id.
 * Hirer-only data (notes) is never selected by the candidate-facing functions.
 */

const APP_COLUMNS = `a.id, a.job_id, a.candidate_id, a.resume_id, a.cover_note, a.status, a.created_at, a.updated_at,
  a.consent_resume_at, a.consent_assessment_at, a.consent_version`

async function getCandidateExperienceLevel(userId, client = pool) {
  const { rows } = await client.query('SELECT experience_level FROM profiles WHERE user_id = $1', [userId])
  return rows[0] ? rows[0].experience_level : 'fresher' // schema default
}

async function findByJobAndCandidate(jobId, candidateId, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${APP_COLUMNS} FROM applications a WHERE a.job_id = $1 AND a.candidate_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [jobId, candidateId],
  )
  return rows[0] || null
}

async function insertApplication({ jobId, candidateId, resumeId, coverNote, consentResume = false, consentAssessment = false, consentVersion = null }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO applications (job_id, candidate_id, resume_id, cover_note, consent_resume_at, consent_assessment_at, consent_version)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN now() END, CASE WHEN $6::boolean THEN now() END, $7) RETURNING id`,
    [jobId, candidateId, resumeId, coverNote ?? null, consentResume, consentAssessment, consentVersion],
  )
  return rows[0].id
}

// Re-applying after a withdrawal asks for consent again: the earlier consent ended with the withdrawal.
async function reactivate({ id, resumeId, coverNote, consentResume = false, consentAssessment = false, consentVersion = null }, client = pool) {
  await client.query(
    `UPDATE applications SET status = 'submitted', resume_id = $2, cover_note = $3,
            consent_resume_at = CASE WHEN $4::boolean THEN now() END,
            consent_assessment_at = CASE WHEN $5::boolean THEN now() END,
            consent_version = $6
      WHERE id = $1`,
    [id, resumeId, coverNote ?? null, consentResume, consentAssessment, consentVersion],
  )
}

/** Grants (never revokes) consent. Existing timestamps are kept. */
async function grantConsent({ id, candidateId, resume, assessment, version }) {
  const { rows } = await pool.query(
    `UPDATE applications
        SET consent_resume_at = CASE WHEN $3::boolean THEN COALESCE(consent_resume_at, now()) ELSE consent_resume_at END,
            consent_assessment_at = CASE WHEN $4::boolean THEN COALESCE(consent_assessment_at, now()) ELSE consent_assessment_at END,
            consent_version = $5
      WHERE id = $1 AND candidate_id = $2 RETURNING id`,
    [id, candidateId, Boolean(resume), Boolean(assessment), version],
  )
  return rows.length > 0
}

async function addHistory({ applicationId, fromStatus, toStatus, changedBy, note, reasonCode }, client = pool) {
  await client.query(
    `INSERT INTO application_status_history (application_id, from_status, to_status, changed_by, note, reason_code)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [applicationId, fromStatus ?? null, toStatus, changedBy ?? null, note ?? null, reasonCode ?? null],
  )
}

/** Conditional transition: only succeeds if the row is still in `from` (guards concurrent changes). */
async function transition({ id, from, to }, client = pool) {
  const { rows } = await client.query(
    `UPDATE applications SET status = $3::text WHERE id = $1 AND status = ANY($2::text[]) RETURNING id, status`,
    [id, from, to],
  )
  return rows[0] || null
}

async function listForCandidate(candidateId) {
  const { rows } = await pool.query(
    `SELECT ${APP_COLUMNS}, j.title AS job_title, j.status AS job_status, o.name AS organization_name
       FROM applications a
       JOIN job_openings j ON j.id = a.job_id
       JOIN organizations o ON o.id = j.organization_id
      WHERE a.candidate_id = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [candidateId],
  )
  return rows
}

async function getForCandidate(id, candidateId) {
  const { rows } = await pool.query(
    `SELECT ${APP_COLUMNS}, j.title AS job_title, j.description AS job_description, j.status AS job_status,
            j.location AS job_location, j.employment_type, j.experience_level, j.blind_review AS job_blind_review, o.name AS organization_name,
            r.original_filename AS resume_filename,
            COALESCE((SELECT json_agg(json_build_object('from_status', h.from_status, 'to_status', h.to_status, 'created_at', h.created_at, 'reason_code', h.reason_code) ORDER BY h.id)
                        FROM application_status_history h WHERE h.application_id = a.id), '[]'::json) AS history
       FROM applications a
       JOIN job_openings j ON j.id = a.job_id
       JOIN organizations o ON o.id = j.organization_id
       JOIN resumes r ON r.id = a.resume_id
      WHERE a.id = $1 AND a.candidate_id = $2`,
    [id, candidateId],
  )
  return rows[0] || null
}

async function getByIdForCandidate(id, candidateId, client = pool) {
  const { rows } = await client.query(`SELECT ${APP_COLUMNS} FROM applications a WHERE a.id = $1 AND a.candidate_id = $2`, [id, candidateId])
  return rows[0] || null
}

module.exports = {
  getCandidateExperienceLevel, findByJobAndCandidate, insertApplication, reactivate, addHistory, transition, grantConsent,
  listForCandidate, getForCandidate, getByIdForCandidate,
}
