const { pool } = require('../config/db')
const { evaluatedAnswerSql } = require('../utils/evaluatedAnswer')

/**
 * Read queries (plus the weekly-goal upsert) behind the candidate preparation dashboard.
 *
 * Privacy / scoping rules, identical to dashboardModel:
 *  - every function takes the caller's userId and filters on it;
 *  - only PRACTICE records are used (application_id IS NULL); hiring-assessment attempts are never included;
 *  - no function selects test cases, source code, model answers or any hidden evaluator data.
 */

const num = (v) => (v === null || v === undefined ? null : Number(v))

/** Every topic with the caller's interview and coding evidence for it (topics with no practice come back with zeros). */
async function getTopicStats(userId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name AS topic,
            i.avg_score, COALESCE(i.answers, 0)::int AS answers, COALESCE(i.unscored, 0)::int AS unscored, i.last_at AS interview_last,
            COALESCE(c.attempted, 0)::int AS attempted, COALESCE(c.solved, 0)::int AS solved, c.last_at AS coding_last
       FROM topics t
       LEFT JOIN (
         SELECT q.topic_id,
                avg(ia.technical_score) FILTER (WHERE ${evaluatedAnswerSql('ia')}) AS avg_score,
                count(*) FILTER (WHERE ${evaluatedAnswerSql('ia')}) AS answers,
                count(*) FILTER (WHERE NOT ${evaluatedAnswerSql('ia')}) AS unscored, max(ia.created_at) AS last_at
           FROM interview_answers ia
           JOIN interview_questions q ON q.id = ia.question_id
           JOIN interview_sessions s ON s.id = q.session_id
          WHERE s.user_id = $1 AND s.application_id IS NULL AND ia.technical_score IS NOT NULL
          GROUP BY q.topic_id
       ) i ON i.topic_id = t.id
       LEFT JOIN (
         SELECT cp.topic_id, count(DISTINCT cs.problem_id) AS attempted,
                count(DISTINCT cs.problem_id) FILTER (WHERE cs.status = 'passed') AS solved, max(cs.submitted_at) AS last_at
           FROM coding_submissions cs
           JOIN coding_problems cp ON cp.id = cs.problem_id
          WHERE cs.user_id = $1 AND cs.application_id IS NULL
          GROUP BY cp.topic_id
       ) c ON c.topic_id = t.id
      ORDER BY t.name`,
    [userId],
  )
  return rows.map((r) => ({
    topicId: Number(r.id), topic: r.topic, interviewAverage: num(r.avg_score), interviewAnswers: r.answers, interviewUnscored: r.unscored,
    codingAttempted: r.attempted, codingSolved: r.solved,
    lastPracticedAt: [r.interview_last, r.coding_last].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null,
  }))
}

/** Per-day count of practice actions (answers given + code submissions), UTC days, all time. */
async function getActivityDays(userId) {
  const { rows } = await pool.query(
    `SELECT day, sum(n)::int AS count FROM (
        SELECT to_char(ia.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, 1 AS n
          FROM interview_answers ia
          JOIN interview_questions q ON q.id = ia.question_id
          JOIN interview_sessions s ON s.id = q.session_id
         WHERE s.user_id = $1 AND s.application_id IS NULL
        UNION ALL
        SELECT to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 1
          FROM coding_submissions WHERE user_id = $1 AND application_id IS NULL
     ) x GROUP BY day ORDER BY day`,
    [userId],
  )
  return rows.map((r) => ({ day: r.day, count: r.count }))
}

/** Average final score of the latest completed practice interviews. */
async function getRecentInterviewAverage(userId, limit = 5) {
  const { rows } = await pool.query(
    `SELECT avg(final_score) AS avg, count(*)::int AS n FROM (
        SELECT final_score FROM interview_sessions
         WHERE user_id = $1 AND application_id IS NULL AND status = 'completed' AND final_score IS NOT NULL
         ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT $2) x`,
    [userId, limit],
  )
  return { average: num(rows[0].avg), count: rows[0].n }
}

async function getInProgressInterview(userId) {
  const { rows } = await pool.query(
    `SELECT id, target_role, interview_type, difficulty, started_at FROM interview_sessions
      WHERE user_id = $1 AND application_id IS NULL AND status = 'in_progress'
      ORDER BY started_at DESC, id DESC LIMIT 1`,
    [userId],
  )
  const r = rows[0]
  return r ? { id: Number(r.id), targetRole: r.target_role, interviewType: r.interview_type, difficulty: r.difficulty, startedAt: r.started_at } : null
}

/** Practice completed since `weekStart` (a Date): finished interviews and distinct problems solved. */
async function getWeeklyProgress(userId, weekStart) {
  const { rows: a } = await pool.query(
    `SELECT count(*)::int AS n FROM interview_sessions
      WHERE user_id = $1 AND application_id IS NULL AND status = 'completed' AND completed_at >= $2`,
    [userId, weekStart],
  )
  const { rows: b } = await pool.query(
    `SELECT count(DISTINCT problem_id)::int AS n FROM coding_submissions
      WHERE user_id = $1 AND application_id IS NULL AND status = 'passed' AND submitted_at >= $2`,
    [userId, weekStart],
  )
  return { interviews: a[0].n, problems: b[0].n }
}

/** Problems solved / attempted per difficulty, against the number of problems that exist. */
async function getCodingCoverageByDifficulty(userId) {
  const { rows } = await pool.query(
    `SELECT p.difficulty, count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM coding_submissions cs WHERE cs.problem_id = p.id AND cs.user_id = $1 AND cs.application_id IS NULL))::int AS attempted,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM coding_submissions cs WHERE cs.problem_id = p.id AND cs.user_id = $1 AND cs.application_id IS NULL AND cs.status = 'passed'))::int AS solved
       FROM coding_problems p GROUP BY p.difficulty`,
    [userId],
  )
  const order = { easy: 0, medium: 1, hard: 2 }
  return rows.map((r) => ({ difficulty: r.difficulty, total: r.total, attempted: r.attempted, solved: r.solved })).sort((x, y) => order[x.difficulty] - order[y.difficulty])
}

/** Problems the caller has NOT solved yet, in the given topics (id and labels only - never tests or solutions). */
async function getUnsolvedProblems(userId, topicIds) {
  if (!topicIds.length) return []
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.difficulty, p.topic_id, t.name AS topic
       FROM coding_problems p JOIN topics t ON t.id = p.topic_id
      WHERE p.topic_id = ANY($2::bigint[])
        AND NOT EXISTS (SELECT 1 FROM coding_submissions cs WHERE cs.problem_id = p.id AND cs.user_id = $1 AND cs.application_id IS NULL AND cs.status = 'passed')
      ORDER BY p.id`,
    [userId, topicIds],
  )
  return rows.map((r) => ({ id: Number(r.id), title: r.title, difficulty: r.difficulty, topicId: Number(r.topic_id), topic: r.topic }))
}

async function hasProfileSkills(userId) {
  const { rows } = await pool.query('SELECT 1 FROM user_skills WHERE user_id = $1 LIMIT 1', [userId])
  return rows.length > 0
}

/* ------------------------------ weekly goals ------------------------------ */

async function getGoals(userId) {
  const { rows } = await pool.query('SELECT weekly_interviews, weekly_problems, updated_at FROM user_goals WHERE user_id = $1', [userId])
  const r = rows[0]
  return r ? { weeklyInterviews: r.weekly_interviews, weeklyProblems: r.weekly_problems, updatedAt: r.updated_at } : null
}

async function upsertGoals(userId, { weeklyInterviews, weeklyProblems }) {
  const { rows } = await pool.query(
    `INSERT INTO user_goals (user_id, weekly_interviews, weekly_problems) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET weekly_interviews = EXCLUDED.weekly_interviews, weekly_problems = EXCLUDED.weekly_problems, updated_at = now()
     RETURNING weekly_interviews, weekly_problems, updated_at`,
    [userId, weeklyInterviews, weeklyProblems],
  )
  const r = rows[0]
  return { weeklyInterviews: r.weekly_interviews, weeklyProblems: r.weekly_problems, updatedAt: r.updated_at }
}

/* ------------------------------ previous-attempt comparison ------------------------------ */

const dimensionAverages = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT avg(ia.technical_score) AS technical, avg(ia.relevance_score) AS relevance, avg(ia.clarity_score) AS clarity,
            avg(ia.completeness_score) AS completeness, count(ia.id)::int AS answers
       FROM interview_questions q JOIN interview_answers ia ON ia.question_id = q.id WHERE q.session_id = $1 AND ${evaluatedAnswerSql('ia')}`,
    [sessionId],
  )
  const r = rows[0]
  return { technical: num(r.technical), relevance: num(r.relevance), clarity: num(r.clarity), completeness: num(r.completeness), answers: r.answers }
}

const topicAverages = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT t.name AS topic, avg(ia.technical_score) AS score FROM interview_questions q
       JOIN interview_answers ia ON ia.question_id = q.id JOIN topics t ON t.id = q.topic_id
      WHERE q.session_id = $1 AND ia.technical_score IS NOT NULL AND ${evaluatedAnswerSql('ia')} GROUP BY t.name`,
    [sessionId],
  )
  return new Map(rows.map((r) => [r.topic, num(r.score)]))
}

/**
 * The caller's own COMPLETED practice session and the one before it of the same interview type and target role.
 * Returns null when the session is not the caller's, is not a practice session, or is not completed.
 */
async function getComparisonSessions(userId, sessionId) {
  const { rows } = await pool.query(
    `SELECT id, interview_type, target_role, difficulty, final_score, completed_at FROM interview_sessions
      WHERE id = $1 AND user_id = $2 AND application_id IS NULL AND status = 'completed'`,
    [sessionId, userId],
  )
  const current = rows[0]
  if (!current) return null
  const { rows: prev } = await pool.query(
    `SELECT id, interview_type, target_role, difficulty, final_score, completed_at FROM interview_sessions
      WHERE user_id = $1 AND application_id IS NULL AND status = 'completed' AND id <> $2
        AND interview_type = $3 AND lower(target_role) = lower($4)
        AND (completed_at < $5 OR (completed_at = $5 AND id < $2))
      ORDER BY completed_at DESC, id DESC LIMIT 1`,
    [userId, current.id, current.interview_type, current.target_role, current.completed_at],
  )
  const shape = async (s) => s && ({
    id: Number(s.id), interviewType: s.interview_type, targetRole: s.target_role, difficulty: s.difficulty,
    finalScore: num(s.final_score), completedAt: s.completed_at, dimensions: await dimensionAverages(s.id), topicScores: await topicAverages(s.id),
  })
  return { current: await shape(current), previous: await shape(prev[0]) }
}

module.exports = {
  getTopicStats, getActivityDays, getRecentInterviewAverage, getInProgressInterview, getWeeklyProgress,
  getCodingCoverageByDifficulty, getUnsolvedProblems, hasProfileSkills, getGoals, upsertGoals, getComparisonSessions,
}
