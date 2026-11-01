const { pool } = require('../config/db')

/**
 * `coding_problems` (joined with `topics` for a readable topic name) and `coding_submissions`.
 *
 * IMPORTANT: neither getAllProblems nor getProblemById selects
 * `cp.test_cases`. That column can hold hidden/private test data (see
 * database/schema.sql's `is_hidden` field in each test case entry) and
 * must never reach the browser — only the future Docker execution
 * service (Phase 9) reads it, directly from the database, server-side.
 */

async function getAllProblems({ topic, difficulty, search } = {}) {
  const { rows } = await pool.query(
    `SELECT cp.id, cp.title, cp.description, cp.difficulty, cp.constraints,
            cp.examples, cp.created_at, t.name AS topic
     FROM coding_problems cp
     LEFT JOIN topics t ON t.id = cp.topic_id
     WHERE ($1::text IS NULL OR t.name = $1)
       AND ($2::text IS NULL OR cp.difficulty = $2)
       AND ($3::text IS NULL OR cp.title ILIKE '%' || $3 || '%')
     ORDER BY cp.id`,
    [topic ?? null, difficulty ?? null, search ?? null],
  )
  return rows
}

async function getProblemById(id) {
  const { rows } = await pool.query(
    `SELECT cp.id, cp.title, cp.description, cp.difficulty, cp.constraints,
            cp.examples, cp.created_at, t.name AS topic
     FROM coding_problems cp
     LEFT JOIN topics t ON t.id = cp.topic_id
     WHERE cp.id = $1`,
    [id],
  )
  return rows[0] || null
}

async function createSubmission({
  userId, problemId, sessionId, applicationId, language, sourceCode,
  testCasesPassed = 0, testCasesTotal = 0, executionTimeMs, memoryUsedKb,
  timeComplexityEstimate, spaceComplexityEstimate, codeQualityScore, status = 'pending',
}) {
  const { rows } = await pool.query(
    `INSERT INTO coding_submissions (
       user_id, problem_id, session_id, language, source_code,
       test_cases_passed, test_cases_total, execution_time_ms, memory_used_kb,
       time_complexity_estimate, space_complexity_estimate, code_quality_score, status, application_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      userId, problemId, sessionId ?? null, language, sourceCode,
      testCasesPassed, testCasesTotal, executionTimeMs ?? null, memoryUsedKb ?? null,
      timeComplexityEstimate ?? null, spaceComplexityEstimate ?? null, codeQualityScore ?? null, status, applicationId ?? null,
    ],
  )
  return rows[0]
}

async function getSubmissionById(id) {
  const { rows } = await pool.query('SELECT * FROM coding_submissions WHERE id = $1', [id])
  return rows[0] || null
}

async function getSubmissionsByUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM coding_submissions WHERE user_id = $1 AND application_id IS NULL ORDER BY submitted_at DESC',
    [userId],
  )
  return rows
}

/** Per-problem standing for ONE user's practice: solved (any passed submission), attempts, last attempt. No code or tests. */
async function getProgressByProblem(userId) {
  const { rows } = await pool.query(
    `SELECT problem_id, count(*)::int AS attempts, bool_or(status = 'passed') AS solved, max(submitted_at) AS last_submitted_at
       FROM coding_submissions WHERE user_id = $1 AND application_id IS NULL GROUP BY problem_id ORDER BY problem_id`,
    [userId],
  )
  return rows.map((r) => ({ problemId: Number(r.problem_id), status: r.solved ? 'solved' : 'attempted', attempts: r.attempts, lastSubmittedAt: r.last_submitted_at }))
}

async function getSubmissionsByProblem(problemId) {
  const { rows } = await pool.query(
    'SELECT * FROM coding_submissions WHERE problem_id = $1 ORDER BY submitted_at DESC',
    [problemId],
  )
  return rows
}

async function getSubmissionsBySession(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM coding_submissions WHERE session_id = $1 ORDER BY submitted_at DESC',
    [sessionId],
  )
  return rows
}

/**
 * INTERNAL USE ONLY — never call this from a controller that returns its
 * result to the browser. Returns the problem's full test_cases array
 * (including any is_hidden entries), for the coding service to send to
 * the code executor. Contrast with getAllProblems/getProblemById, which
 * both deliberately exclude this column.
 */
async function getProblemTestCases(problemId) {
  const { rows } = await pool.query('SELECT test_cases FROM coding_problems WHERE id = $1', [problemId])
  return rows[0]?.test_cases || []
}

/**
 * Persists the executor's outcome onto an existing submission row.
 * `status` here must already be one of coding_submissions' 4 allowed
 * values (pending/passed/failed/error) — see codingService.js for the
 * mapping from the executor's richer status vocabulary down to these.
 */
async function updateSubmissionResult(id, { status, testCasesPassed, testCasesTotal, executionTimeMs, memoryUsedKb }) {
  const { rows } = await pool.query(
    `UPDATE coding_submissions
     SET status = $2,
         test_cases_passed = $3,
         test_cases_total = $4,
         execution_time_ms = $5,
         memory_used_kb = $6
     WHERE id = $1
     RETURNING *`,
    [id, status, testCasesPassed, testCasesTotal, executionTimeMs ?? null, memoryUsedKb ?? null],
  )
  return rows[0] || null
}

module.exports = {
  getProgressByProblem,
  getAllProblems, getProblemById, getProblemTestCases, createSubmission, getSubmissionById,
  getSubmissionsByUser, getSubmissionsByProblem, getSubmissionsBySession, updateSubmissionResult,
}
