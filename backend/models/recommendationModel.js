const { pool } = require('../config/db')

/** `recommended_questions`, referencing `coding_problems` and `topics`. */

async function createRecommendation({ userId, problemId, topicId, reason }) {
  const { rows } = await pool.query(
    `INSERT INTO recommended_questions (user_id, problem_id, topic_id, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, problemId ?? null, topicId ?? null, reason ?? null],
  )
  return rows[0]
}

async function getRecommendationsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT rq.id, rq.reason, rq.created_at,
            cp.id AS problem_id, cp.title AS problem_title,
            t.id AS topic_id, t.name AS topic_name
     FROM recommended_questions rq
     LEFT JOIN coding_problems cp ON cp.id = rq.problem_id
     LEFT JOIN topics t ON t.id = rq.topic_id
     WHERE rq.user_id = $1
     ORDER BY rq.created_at DESC`,
    [userId],
  )
  return rows
}

async function deleteRecommendationsForUser(userId, client = pool) {
  await client.query('DELETE FROM recommended_questions WHERE user_id = $1', [userId])
}

/** Transactionally clears a user's old recommendations and inserts a fresh batch (used by Phase 7/12's recommendation logic). */
async function replaceRecommendationsForUser(userId, recommendations, client = pool) {
  await deleteRecommendationsForUser(userId, client)
  const created = []
  for (const rec of recommendations) {
    const { rows } = await client.query(
      `INSERT INTO recommended_questions (user_id, problem_id, topic_id, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, rec.problemId ?? null, rec.topicId ?? null, rec.reason ?? null],
    )
    created.push(rows[0])
  }
  return created
}

module.exports = {
  createRecommendation, getRecommendationsForUser,
  deleteRecommendationsForUser, replaceRecommendationsForUser,
}
