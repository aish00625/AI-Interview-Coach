const { pool } = require('../config/db')

/** Access audit log (Phase J): who in a hiring organization opened sensitive candidate data. Append-only from the API. */

async function record({ organizationId, actorId, applicationId, action, detail }, client = pool) {
  await client.query(
    'INSERT INTO access_audit_log (organization_id, actor_id, application_id, action, detail) VALUES ($1, $2, $3, $4, $5)',
    [organizationId, actorId, applicationId, action, detail ? JSON.stringify(detail) : null],
  )
}

/** Organization-wide view for owners. Cursor = last id seen. */
async function listForOrganization({ organizationId, applicationId = null, before = null, limit = 50 }) {
  const { rows } = await pool.query(
    `SELECT l.id, l.action, l.created_at, l.application_id, u.name AS actor_name, j.title AS job_title
       FROM access_audit_log l
       LEFT JOIN users u ON u.id = l.actor_id
       LEFT JOIN applications a ON a.id = l.application_id
       LEFT JOIN job_openings j ON j.id = a.job_id
      WHERE l.organization_id = $1
        AND ($2::bigint IS NULL OR l.application_id = $2)
        AND ($3::bigint IS NULL OR l.id < $3)
      ORDER BY l.id DESC LIMIT $4`,
    [organizationId, applicationId, before, limit],
  )
  return rows
}

/** What a candidate may see about their own application: the organization and the kind of access, never who. */
async function listForCandidateApplication({ applicationId, candidateId }) {
  const { rows } = await pool.query(
    `SELECT l.id, l.action, l.created_at
       FROM access_audit_log l JOIN applications a ON a.id = l.application_id
      WHERE l.application_id = $1 AND a.candidate_id = $2
      ORDER BY l.id DESC LIMIT 200`,
    [applicationId, candidateId],
  )
  return rows
}

module.exports = { record, listForOrganization, listForCandidateApplication }
