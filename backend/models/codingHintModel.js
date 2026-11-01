const { pool } = require('../config/db')

/** Tiered hints (coding_problems.hints) and the per-user reveal log (coding_hint_reveals, migration 009). */

async function getHints(problemId) {
  const { rows } = await pool.query('SELECT hints FROM coding_problems WHERE id = $1', [problemId])
  if (!rows[0]) return null
  return Array.isArray(rows[0].hints) ? rows[0].hints : []
}

async function getRevealedLevels(userId, problemId) {
  const { rows } = await pool.query(
    'SELECT level FROM coding_hint_reveals WHERE user_id = $1 AND problem_id = $2 ORDER BY level',
    [userId, problemId],
  )
  return rows.map((r) => Number(r.level))
}

/** Idempotent; the primary key makes a double click harmless. */
async function recordReveal(userId, problemId, level) {
  await pool.query(
    'INSERT INTO coding_hint_reveals (user_id, problem_id, level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, problemId, level],
  )
}

module.exports = { getHints, getRevealedLevels, recordReveal }
