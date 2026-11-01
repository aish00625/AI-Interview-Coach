const { pool } = require('../config/db')

/**
 * `performance_scores`. Just storage/retrieval here — the actual scoring
 * formula and aggregation logic belongs to Phase 7 (per-answer scores)
 * and Phase 12 (dashboard analytics).
 */

async function createPerformanceScore({
  userId, sessionId, technicalInterviewScore, codingScore, communicationScore, overallScore,
}) {
  const { rows } = await pool.query(
    `INSERT INTO performance_scores (
       user_id, session_id, technical_interview_score, coding_score, communication_score, overall_score
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [userId, sessionId ?? null, technicalInterviewScore ?? null, codingScore ?? null, communicationScore ?? null, overallScore ?? null],
  )
  return rows[0]
}

async function getPerformanceHistoryForUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM performance_scores WHERE user_id = $1 ORDER BY calculated_at DESC',
    [userId],
  )
  return rows
}

async function getPerformanceForSession(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM performance_scores WHERE session_id = $1 ORDER BY calculated_at DESC',
    [sessionId],
  )
  return rows
}

module.exports = { createPerformanceScore, getPerformanceHistoryForUser, getPerformanceForSession }
