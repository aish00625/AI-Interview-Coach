const { pool } = require('../config/db')

/**
 * Hirer side of migration 018: assessment definitions, sections, items, reviewers and invitations.
 * Every read and write is scoped to the caller's organization in SQL (an id from another organization is simply not found).
 * `client` is the pool or a transaction client.
 */
// Same blind-review rule as hirerApplicationModel: identity is hidden while the application is still being screened.
const MASKED = `(j.blind_review AND a.status NOT IN ('shortlisted', 'hired'))`

const shapeAssessment = (r) => r && ({
  id: Number(r.id), organizationId: Number(r.organization_id), jobId: Number(r.job_id), jobTitle: r.job_title,
  title: r.title, description: r.description, instructions: r.instructions, durationMinutes: r.duration_minutes,
  availableFrom: r.available_from, availableUntil: r.available_until, maxAttempts: r.max_attempts,
  passPercent: r.pass_percent == null ? null : Number(r.pass_percent), monitoringEnabled: r.monitoring_enabled,
  status: r.status, version: r.version, parentId: r.parent_id == null ? null : Number(r.parent_id),
  publishedAt: r.published_at, closedAt: r.closed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  counts: r.invited == null ? undefined : { invited: Number(r.invited), started: Number(r.started), submitted: Number(r.submitted) },
})

async function listForOrg(organizationId, { reviewerUserId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT x.*, j.title AS job_title,
            (SELECT count(*) FROM assessment_invitations i WHERE i.assessment_id = x.id AND i.revoked_at IS NULL) AS invited,
            (SELECT count(*) FROM assessment_attempts t WHERE t.assessment_id = x.id) AS started,
            (SELECT count(*) FROM assessment_attempts t WHERE t.assessment_id = x.id AND t.status <> 'in_progress') AS submitted
       FROM assessments x JOIN job_openings j ON j.id = x.job_id
      WHERE x.organization_id = $1
        AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM assessment_reviewers r WHERE r.assessment_id = x.id AND r.user_id = $2))
      ORDER BY x.updated_at DESC, x.id DESC`,
    [organizationId, reviewerUserId],
  )
  return rows.map(shapeAssessment)
}

async function getForOrg(id, organizationId, client = pool, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT x.*, j.title AS job_title FROM assessments x JOIN job_openings j ON j.id = x.job_id
      WHERE x.id = $1 AND x.organization_id = $2${forUpdate ? ' FOR UPDATE OF x' : ''}`,
    [id, organizationId],
  )
  return shapeAssessment(rows[0] || null)
}

async function create(organizationId, createdBy, f, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO assessments (organization_id, job_id, title, description, instructions, duration_minutes, available_from, available_until,
                              max_attempts, pass_percent, monitoring_enabled, version, parent_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [organizationId, f.jobId, f.title, f.description, f.instructions, f.durationMinutes, f.availableFrom, f.availableUntil,
      f.maxAttempts, f.passPercent, f.monitoringEnabled, f.version || 1, f.parentId || null, createdBy],
  )
  return Number(rows[0].id)
}

async function update(id, organizationId, f, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE assessments SET job_id = $3, title = $4, description = $5, instructions = $6, duration_minutes = $7, available_from = $8,
            available_until = $9, max_attempts = $10, pass_percent = $11, monitoring_enabled = $12
      WHERE id = $1 AND organization_id = $2 AND status = 'draft'`,
    [id, organizationId, f.jobId, f.title, f.description, f.instructions, f.durationMinutes, f.availableFrom, f.availableUntil,
      f.maxAttempts, f.passPercent, f.monitoringEnabled],
  )
  return rowCount === 1
}

async function setStatus(id, organizationId, status, client = pool) {
  const { rows } = await client.query(
    `UPDATE assessments SET status = $3::varchar,
            published_at = CASE WHEN $3::varchar = 'published' THEN coalesce(published_at, now()) ELSE published_at END,
            closed_at = CASE WHEN $3::varchar = 'closed' THEN now() ELSE closed_at END
      WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [id, organizationId, status],
  )
  return rows.length === 1
}

async function hasAttempts(assessmentId, client = pool) {
  const { rows } = await client.query('SELECT 1 FROM assessment_attempts WHERE assessment_id = $1 LIMIT 1', [assessmentId])
  return rows.length > 0
}

async function maxVersionInLineage(rootId, organizationId, client = pool) {
  const { rows } = await client.query(
    `WITH RECURSIVE up AS (SELECT id, parent_id FROM assessments WHERE id = $1 AND organization_id = $2
                           UNION ALL SELECT a.id, a.parent_id FROM assessments a JOIN up ON a.id = up.parent_id)
     SELECT coalesce(max(version), 1) AS v FROM assessments
      WHERE organization_id = $2 AND (id IN (SELECT id FROM up) OR parent_id IN (SELECT id FROM up))`,
    [rootId, organizationId],
  )
  return Number(rows[0].v)
}

/** Sections with their items; item details are the hirer's view (question summary, archived flag, coding problem title). */
async function getSections(assessmentId, client = pool) {
  const { rows: sections } = await client.query('SELECT * FROM assessment_sections WHERE assessment_id = $1 ORDER BY position', [assessmentId])
  const { rows: items } = await client.query(
    `SELECT i.*, s.kind, q.question_text, q.category, q.difficulty AS q_difficulty, q.question_type, q.archived_at IS NOT NULL AS archived,
            cp.title AS problem_title, cp.difficulty AS p_difficulty
       FROM assessment_items i JOIN assessment_sections s ON s.id = i.section_id
       LEFT JOIN mcq_questions q ON q.id = i.mcq_question_id
       LEFT JOIN coding_problems cp ON cp.id = i.coding_problem_id
      WHERE s.assessment_id = $1 ORDER BY s.position, i.position`,
    [assessmentId],
  )
  return sections.map((s) => ({
    id: Number(s.id), kind: s.kind, position: s.position, durationMinutes: s.duration_minutes, allowBack: s.allow_back,
    randomize: s.randomize, negativeMarking: Number(s.negative_marking),
    items: items.filter((i) => String(i.section_id) === String(s.id)).map((i) => ({
      id: Number(i.id), position: i.position, marks: Number(i.marks),
      mcqQuestionId: i.mcq_question_id == null ? null : Number(i.mcq_question_id),
      codingProblemId: i.coding_problem_id == null ? null : Number(i.coding_problem_id),
      summary: i.mcq_question_id != null ? i.question_text : i.problem_title,
      category: i.category || null, difficulty: i.q_difficulty || i.p_difficulty || null, questionType: i.question_type || null,
      archived: Boolean(i.archived),
    })),
  }))
}

/** Replaces all sections and items of a DRAFT (the caller has locked the assessment row and checked there are no attempts). */
async function replaceSections(assessmentId, sections, client) {
  await client.query('DELETE FROM assessment_sections WHERE assessment_id = $1', [assessmentId])
  for (const s of sections) {
    const { rows } = await client.query(
      `INSERT INTO assessment_sections (assessment_id, kind, position, duration_minutes, allow_back, randomize, negative_marking)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [assessmentId, s.kind, s.position, s.durationMinutes, s.allowBack, s.randomize, s.negativeMarking],
    )
    let pos = 0
    for (const it of s.items) {
      pos += 1
      await client.query(
        'INSERT INTO assessment_items (section_id, position, mcq_question_id, coding_problem_id, marks) VALUES ($1,$2,$3,$4,$5)',
        [rows[0].id, pos, it.mcqQuestionId || null, it.codingProblemId || null, it.marks],
      )
    }
  }
}

async function listReviewers(assessmentId) {
  const { rows } = await pool.query(
    `SELECT r.user_id, u.name, m.member_role FROM assessment_reviewers r JOIN users u ON u.id = r.user_id
       JOIN assessments x ON x.id = r.assessment_id
       LEFT JOIN organization_members m ON m.user_id = r.user_id AND m.organization_id = x.organization_id
      WHERE r.assessment_id = $1 ORDER BY u.name`,
    [assessmentId],
  )
  return rows.map((r) => ({ userId: Number(r.user_id), name: r.name, memberRole: r.member_role || null }))
}

async function replaceReviewers(assessmentId, userIds, assignedBy, client) {
  await client.query('DELETE FROM assessment_reviewers WHERE assessment_id = $1', [assessmentId])
  for (const id of userIds) {
    await client.query('INSERT INTO assessment_reviewers (assessment_id, user_id, assigned_by) VALUES ($1,$2,$3)', [assessmentId, id, assignedBy])
  }
}

async function isReviewer(assessmentId, userId, client = pool) {
  const { rows } = await client.query('SELECT 1 FROM assessment_reviewers WHERE assessment_id = $1 AND user_id = $2', [assessmentId, userId])
  return rows.length > 0
}

/** Applications to the assessment's job, with invitation and attempt status. Names follow the blind-review rule. */
async function listCandidates(assessmentId, organizationId) {
  const { rows } = await pool.query(
    `SELECT a.id AS application_id, a.status AS application_status, a.consent_assessment_at IS NOT NULL AS consented,
            CASE WHEN ${MASKED} THEN NULL ELSE u.name END AS candidate_name, ${MASKED} AS is_masked,
            i.id AS invitation_id, i.created_at AS invited_at, i.revoked_at,
            (SELECT count(*) FROM assessment_attempts t WHERE t.invitation_id = i.id) AS attempts,
            (SELECT t.status FROM assessment_attempts t WHERE t.invitation_id = i.id ORDER BY t.attempt_no DESC LIMIT 1) AS latest_status,
            (SELECT t.id FROM assessment_attempts t WHERE t.invitation_id = i.id ORDER BY t.attempt_no DESC LIMIT 1) AS latest_attempt_id
       FROM assessments x JOIN job_openings j ON j.id = x.job_id
       JOIN applications a ON a.job_id = x.job_id
       JOIN users u ON u.id = a.candidate_id
       LEFT JOIN assessment_invitations i ON i.assessment_id = x.id AND i.application_id = a.id
      WHERE x.id = $1 AND x.organization_id = $2
      ORDER BY a.created_at`,
    [assessmentId, organizationId],
  )
  return rows.map((r) => ({
    applicationId: Number(r.application_id), applicationStatus: r.application_status, consented: r.consented,
    candidateName: r.candidate_name, identityHidden: r.is_masked,
    invitation: r.invitation_id == null ? null : {
      id: Number(r.invitation_id), invitedAt: r.invited_at, revoked: r.revoked_at != null, attempts: Number(r.attempts),
      latestStatus: r.latest_status || null, latestAttemptId: r.latest_attempt_id == null ? null : Number(r.latest_attempt_id),
    },
  }))
}

/** Applications of THIS job in this organization, locked, so eligibility checks and the insert cannot interleave. */
async function getApplicationsForInvite(assessmentId, organizationId, applicationIds, client) {
  const { rows } = await client.query(
    `SELECT a.id, a.status, a.candidate_id, a.consent_assessment_at FROM applications a
       JOIN assessments x ON x.job_id = a.job_id
      WHERE x.id = $1 AND x.organization_id = $2 AND a.id = ANY($3::bigint[]) FOR UPDATE OF a`,
    [assessmentId, organizationId, applicationIds],
  )
  return rows
}

/** Creates (or re-activates a revoked) invitation. Returns the invitation id. */
async function upsertInvitation(assessmentId, applicationId, invitedBy, client) {
  const { rows } = await client.query(
    `INSERT INTO assessment_invitations (assessment_id, application_id, invited_by) VALUES ($1,$2,$3)
     ON CONFLICT (assessment_id, application_id) DO UPDATE SET revoked_at = NULL
     RETURNING id, (xmax = 0) AS created`,
    [assessmentId, applicationId, invitedBy],
  )
  return { id: Number(rows[0].id), created: rows[0].created }
}

async function revokeInvitation(invitationId, assessmentId, organizationId) {
  const { rows } = await pool.query(
    `UPDATE assessment_invitations i SET revoked_at = coalesce(i.revoked_at, now())
       FROM assessments x WHERE i.id = $1 AND i.assessment_id = $2 AND x.id = i.assessment_id AND x.organization_id = $3
     RETURNING i.id`,
    [invitationId, assessmentId, organizationId],
  )
  return rows.length === 1
}

module.exports = {
  MASKED, listForOrg, getForOrg, create, update, setStatus, hasAttempts, maxVersionInLineage, getSections, replaceSections,
  listReviewers, replaceReviewers, isReviewer, listCandidates, getApplicationsForInvite, upsertInvitation, revokeInvitation,
}
