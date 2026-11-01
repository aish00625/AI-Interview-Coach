const { pool } = require('../config/db')
const { evaluatedAnswerSql } = require('../utils/evaluatedAnswer')

/**
 * Read-only queries over a candidate's OWN private practice history (application_id IS NULL) that drive personalised
 * practice. Hiring-assessment sessions and submissions are excluded everywhere, and every query is scoped by user id.
 */

/** Final scores of the most recent completed practice sessions of one interview type, newest first. */
async function getRecentPracticeScores(userId, interviewType, limit = 3) {
  const { rows } = await pool.query(
    `SELECT final_score FROM interview_sessions
      WHERE user_id = $1 AND application_id IS NULL AND interview_type = $2
        AND status = 'completed' AND final_score IS NOT NULL
      ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT $3`,
    [userId, interviewType, limit],
  )
  return rows.map((r) => Number(r.final_score))
}

/** Question texts from the user's last few practice sessions (to avoid repeating them straight away). */
async function getRecentQuestionTexts(userId, sessions = 3) {
  const { rows } = await pool.query(
    `SELECT q.question_text FROM interview_questions q
      WHERE q.session_id IN (
        SELECT id FROM interview_sessions WHERE user_id = $1 AND application_id IS NULL ORDER BY id DESC LIMIT $2)`,
    [userId, sessions],
  )
  return rows.map((r) => r.question_text)
}

/**
 * Topics where the user's practice results are weakest, from two sources:
 *  - interview answers: average technical score per topic
 *  - coding practice: share of distinct problems in the topic that have NOT been solved (needs >= 2 attempted)
 * Returns [{ topicName, average, source }] with average on a 0-100 scale (lower = weaker), weakest first.
 */
async function getTopicPerformance(userId) {
  const { rows: interview } = await pool.query(
    `SELECT t.name AS topic_name, avg(ia.technical_score)::float AS average, count(*)::int AS answers
       FROM interview_answers ia
       JOIN interview_questions q ON q.id = ia.question_id
       JOIN interview_sessions s ON s.id = q.session_id
       JOIN topics t ON t.id = q.topic_id
      WHERE s.user_id = $1 AND s.application_id IS NULL AND ia.technical_score IS NOT NULL AND ${evaluatedAnswerSql('ia')}
      GROUP BY t.name`,
    [userId],
  )
  const { rows: coding } = await pool.query(
    `SELECT t.name AS topic_name,
            count(DISTINCT cs.problem_id)::int AS attempted,
            count(DISTINCT cs.problem_id) FILTER (WHERE cs.status = 'passed')::int AS solved
       FROM coding_submissions cs
       JOIN coding_problems cp ON cp.id = cs.problem_id
       JOIN topics t ON t.id = cp.topic_id
      WHERE cs.user_id = $1 AND cs.application_id IS NULL
      GROUP BY t.name`,
    [userId],
  )
  const merged = new Map()
  for (const r of interview) merged.set(r.topic_name, { topicName: r.topic_name, average: r.average, source: 'interview answers' })
  for (const r of coding) {
    if (r.attempted < 2) continue
    const pct = (100 * r.solved) / r.attempted
    const prev = merged.get(r.topic_name)
    // Where both exist, the lower (weaker) signal wins and the source says so.
    if (!prev || pct < prev.average) merged.set(r.topic_name, { topicName: r.topic_name, average: pct, source: prev ? 'interview answers and coding practice' : 'coding practice' })
  }
  return [...merged.values()].sort((a, b) => a.average - b.average)
}

module.exports = { getRecentPracticeScores, getRecentQuestionTexts, getTopicPerformance }
