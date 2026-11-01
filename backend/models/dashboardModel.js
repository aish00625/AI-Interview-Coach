const { pool } = require('../config/db')
const { evaluatedAnswerSql } = require('../utils/evaluatedAnswer')

/**
 * Read-only aggregation queries for the dashboard/performance endpoints.
 * Every function takes userId as its first (and usually only) parameter
 * and scopes its query to it — there is no function here that can return
 * another user's data. All SQL is parameterized.
 *
 * `performance_scores` exists in the schema but nothing in the app writes
 * to it yet (no scoring pipeline populates it) — these queries compute
 * everything directly from interview_sessions/interview_answers/
 * coding_submissions instead of reading an empty table.
 *
 * Postgres returns NULL for an AVG()/aggregate over zero matching rows —
 * that comes through the `pg` driver as JS `null`, which every function
 * here preserves as-is (never coerced to 0) so callers can tell "no data
 * yet" apart from "an actual zero."
 */

/** NUMERIC columns come back from `pg` as strings — parse to a number, preserving null. */
function toNumberOrNull(value) {
  return value === null || value === undefined ? null : Number(value)
}

/* ---------------------------- Overview ---------------------------- */

async function getOverviewCounts(userId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS total_interviews,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed_interviews,
       AVG(final_score) FILTER (WHERE status = 'completed') AS average_interview_score
     FROM interview_sessions
     WHERE user_id = $1 AND application_id IS NULL`,
    [userId],
  )
  const session = rows[0]

  const { rows: codingRows } = await pool.query(
    `SELECT
       COUNT(*) AS total_submissions,
       COUNT(*) FILTER (WHERE status = 'passed') AS passed_submissions
     FROM coding_submissions
     WHERE user_id = $1 AND application_id IS NULL`,
    [userId],
  )
  const coding = codingRows[0]

  return {
    totalInterviews: Number(session.total_interviews),
    completedInterviews: Number(session.completed_interviews),
    averageInterviewScore: toNumberOrNull(session.average_interview_score),
    totalCodingSubmissions: Number(coding.total_submissions),
    passedCodingSubmissions: Number(coding.passed_submissions),
  }
}

/** Chronological (oldest first) completed-session scores, most recent `limit` sessions. */
async function getScoreOverTime(userId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, final_score, completed_at
     FROM interview_sessions
     WHERE user_id = $1 AND application_id IS NULL AND status = 'completed' AND final_score IS NOT NULL
     ORDER BY completed_at DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows.reverse().map((r) => ({
    sessionId: r.id,
    date: r.completed_at,
    score: toNumberOrNull(r.final_score),
  }))
}

/** Merges interview sessions + coding submissions into one chronological feed, computed server-side via UNION ALL rather than two round trips merged in Node. */
async function getRecentActivity(userId, limit = 8) {
  const { rows } = await pool.query(
    `(
       SELECT 'interview' AS type, s.id, s.target_role AS title, s.status,
              s.final_score AS score, COALESCE(s.completed_at, s.started_at) AS activity_at
       FROM interview_sessions s
       WHERE s.user_id = $1 AND s.application_id IS NULL
     )
     UNION ALL
     (
       SELECT 'coding' AS type, cs.id, cp.title, cs.status,
              NULL AS score, cs.submitted_at AS activity_at
       FROM coding_submissions cs
       JOIN coding_problems cp ON cp.id = cs.problem_id
       WHERE cs.user_id = $1 AND cs.application_id IS NULL
     )
     ORDER BY activity_at DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows.map((r) => ({
    type: r.type,
    id: r.id,
    title: r.title,
    status: r.status,
    score: toNumberOrNull(r.score),
    date: r.activity_at,
  }))
}

/* ---------------------------- Interview analytics ---------------------------- */

async function getInterviewScoreAverages(userId) {
  const { rows } = await pool.query(
    `SELECT
       AVG(ia.technical_score) AS avg_technical,
       AVG(ia.relevance_score) AS avg_relevance,
       AVG(ia.clarity_score) AS avg_clarity,
       AVG(ia.completeness_score) AS avg_completeness
     FROM interview_answers ia
     JOIN interview_questions iq ON iq.id = ia.question_id
     JOIN interview_sessions s ON s.id = iq.session_id
     WHERE s.user_id = $1 AND s.application_id IS NULL AND ${evaluatedAnswerSql('ia')}`,
    [userId],
  )
  const r = rows[0]
  return {
    averageTechnicalScore: toNumberOrNull(r.avg_technical),
    averageRelevanceScore: toNumberOrNull(r.avg_relevance),
    averageClarityScore: toNumberOrNull(r.avg_clarity),
    averageCompletenessScore: toNumberOrNull(r.avg_completeness),
  }
}

async function getInterviewCountsByType(userId) {
  const { rows } = await pool.query(
    `SELECT interview_type, COUNT(*) AS count
     FROM interview_sessions WHERE user_id = $1 AND application_id IS NULL
     GROUP BY interview_type ORDER BY interview_type`,
    [userId],
  )
  return rows.map((r) => ({ type: r.interview_type, count: Number(r.count) }))
}

async function getInterviewCountsByDifficulty(userId) {
  const { rows } = await pool.query(
    `SELECT difficulty, COUNT(*) AS count
     FROM interview_sessions WHERE user_id = $1 AND application_id IS NULL
     GROUP BY difficulty ORDER BY difficulty`,
    [userId],
  )
  return rows.map((r) => ({ difficulty: r.difficulty, count: Number(r.count) }))
}

async function getSessionStatusBreakdown(userId) {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*) AS count
     FROM interview_sessions WHERE user_id = $1 AND application_id IS NULL
     GROUP BY status`,
    [userId],
  )
  const breakdown = { completed: 0, in_progress: 0, abandoned: 0 }
  rows.forEach((r) => { breakdown[r.status] = Number(r.count) })
  return breakdown
}

/* ---------------------------- Coding analytics ---------------------------- */

async function getCodingStatusBreakdown(userId) {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*) AS count
     FROM coding_submissions WHERE user_id = $1 AND application_id IS NULL
     GROUP BY status`,
    [userId],
  )
  const breakdown = { pending: 0, passed: 0, failed: 0, error: 0 }
  rows.forEach((r) => { breakdown[r.status] = Number(r.count) })
  return breakdown
}

async function getCodingByLanguage(userId) {
  const { rows } = await pool.query(
    `SELECT language,
            COUNT(*) AS attempted,
            COUNT(*) FILTER (WHERE status = 'passed') AS solved
     FROM coding_submissions WHERE user_id = $1 AND application_id IS NULL
     GROUP BY language ORDER BY language`,
    [userId],
  )
  return rows.map((r) => ({ language: r.language, attempted: Number(r.attempted), solved: Number(r.solved) }))
}

async function getCodingByDifficulty(userId) {
  const { rows } = await pool.query(
    `SELECT cp.difficulty,
            COUNT(*) AS attempted,
            COUNT(*) FILTER (WHERE cs.status = 'passed') AS solved
     FROM coding_submissions cs
     JOIN coding_problems cp ON cp.id = cs.problem_id
     WHERE cs.user_id = $1 AND cs.application_id IS NULL
     GROUP BY cp.difficulty ORDER BY cp.difficulty`,
    [userId],
  )
  return rows.map((r) => ({ difficulty: r.difficulty, attempted: Number(r.attempted), solved: Number(r.solved) }))
}

async function getCodingSubmissionsOverTime(userId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT DATE_TRUNC('day', submitted_at) AS day, COUNT(*) AS count
     FROM coding_submissions
     WHERE user_id = $1 AND application_id IS NULL
     GROUP BY day
     ORDER BY day DESC
     LIMIT $2`,
    [userId, limit],
  )
  return rows.reverse().map((r) => ({ date: r.day, count: Number(r.count) }))
}

/* ---------------------------- Skill / topic analytics ---------------------------- */

/**
 * Average interview technical_score per topic, lowest first. Only
 * includes topics with at least one scored answer — a topic the user
 * has never been asked about simply doesn't appear, rather than showing
 * a fabricated 0.
 */
async function getTopicPerformance(userId) {
  const { rows } = await pool.query(
    `SELECT t.name AS topic, AVG(ia.technical_score) AS avg_score, COUNT(*) AS answer_count
     FROM interview_answers ia
     JOIN interview_questions iq ON iq.id = ia.question_id
     JOIN interview_sessions s ON s.id = iq.session_id
     JOIN topics t ON t.id = iq.topic_id
     WHERE s.user_id = $1 AND s.application_id IS NULL AND ia.technical_score IS NOT NULL AND ${evaluatedAnswerSql('ia')}
     GROUP BY t.name
     ORDER BY avg_score ASC`,
    [userId],
  )
  return rows.map((r) => ({
    topic: r.topic,
    averageScore: toNumberOrNull(r.avg_score),
    answerCount: Number(r.answer_count),
  }))
}

module.exports = {
  getOverviewCounts, getScoreOverTime, getRecentActivity,
  getInterviewScoreAverages, getInterviewCountsByType, getInterviewCountsByDifficulty, getSessionStatusBreakdown,
  getCodingStatusBreakdown, getCodingByLanguage, getCodingByDifficulty, getCodingSubmissionsOverTime,
  getTopicPerformance,
}
