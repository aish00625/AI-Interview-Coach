const { pool } = require('../config/db')

const META = 'id, user_id, original_filename, content_type, size_bytes, extraction_status, created_at'

async function insertResume({ userId, originalFilename, contentType, sizeBytes, storageKey, extractedText, extractionStatus }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO resumes (user_id, original_filename, content_type, size_bytes, storage_key, extracted_text, extraction_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${META}`,
    [userId, originalFilename, contentType, sizeBytes, storageKey, extractedText, extractionStatus],
  )
  return rows[0]
}

async function countByUser(userId, client = pool) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM resumes WHERE user_id = $1', [userId])
  return rows[0].n
}

/** Candidate's own resumes (metadata only), with how many applications use each. */
async function listByUser(userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.original_filename, r.content_type, r.size_bytes, r.extraction_status, r.created_at,
            (SELECT count(*)::int FROM applications a WHERE a.resume_id = r.id) AS application_count
       FROM resumes r WHERE r.user_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [userId],
  )
  return rows
}

/** Ownership enforced in SQL: returns null when the resume isn't this user's. Includes storage_key (server-internal). */
async function getOwned(id, userId, { withText = false } = {}) {
  const { rows } = await pool.query(
    `SELECT ${META}, storage_key${withText ? ', extracted_text' : ''} FROM resumes WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return rows[0] || null
}

/** Deletes only if owned and not attached to any application. Returns the deleted row's storage_key or null. */
async function deleteUnusedOwned(id, userId) {
  const { rows } = await pool.query(
    `DELETE FROM resumes r WHERE r.id = $1 AND r.user_id = $2
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.resume_id = r.id)
      RETURNING storage_key`,
    [id, userId],
  )
  return rows[0] ? rows[0].storage_key : null
}

module.exports = { insertResume, countByUser, listByUser, getOwned, deleteUnusedOwned }
