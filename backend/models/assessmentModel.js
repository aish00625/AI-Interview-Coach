const { pool } = require('../config/db')

/**
 * Job assessment configuration + per-application progress (Phase D).
 * Hirer-facing config functions are always called after the job has been verified to belong to the caller's
 * organization; progress functions take an application id that the caller has already authorized.
 */

const DEFAULT_CONFIG = { interview_enabled: false, interview_type: 'technical', interview_difficulty: 'medium' }

async function getConfig(jobId, client = pool) {
  const { rows } = await client.query(
    'SELECT job_id, interview_enabled, interview_type, interview_difficulty FROM job_assessments WHERE job_id = $1',
    [jobId],
  )
  const cfg = rows[0] || { job_id: jobId, ...DEFAULT_CONFIG }
  const { rows: problems } = await client.query(
    `SELECT cp.id, cp.title, cp.difficulty, jap.position
       FROM job_assessment_problems jap JOIN coding_problems cp ON cp.id = jap.problem_id
      WHERE jap.job_id = $1 ORDER BY jap.position, cp.id`,
    [jobId],
  )
  return { ...cfg, problems }
}

/** True once any candidate has started an interview or submitted code for this job — config is then frozen for fairness. */
async function hasActivity(jobId, client = pool) {
  const { rows } = await client.query(
    `SELECT (EXISTS (SELECT 1 FROM interview_sessions s JOIN applications a ON a.id = s.application_id WHERE a.job_id = $1)
          OR EXISTS (SELECT 1 FROM coding_submissions c JOIN applications a ON a.id = c.application_id WHERE a.job_id = $1)) AS active`,
    [jobId],
  )
  return rows[0].active
}

async function countExistingProblems(ids, client = pool) {
  if (!ids.length) return 0
  const { rows } = await client.query('SELECT count(*)::int AS n FROM coding_problems WHERE id = ANY($1::bigint[])', [ids])
  return rows[0].n
}

async function upsertConfig({ jobId, interviewEnabled, interviewType, interviewDifficulty }, client = pool) {
  await client.query(
    `INSERT INTO job_assessments (job_id, interview_enabled, interview_type, interview_difficulty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id) DO UPDATE
       SET interview_enabled = EXCLUDED.interview_enabled,
           interview_type = EXCLUDED.interview_type,
           interview_difficulty = EXCLUDED.interview_difficulty`,
    [jobId, interviewEnabled, interviewType, interviewDifficulty],
  )
}

async function replaceProblems(jobId, problemIds, client = pool) {
  await client.query('DELETE FROM job_assessment_problems WHERE job_id = $1', [jobId])
  for (let i = 0; i < problemIds.length; i++) {
    await client.query('INSERT INTO job_assessment_problems (job_id, problem_id, position) VALUES ($1, $2, $3)', [jobId, problemIds[i], i])
  }
}

async function isProblemInJobAssessment(jobId, problemId, client = pool) {
  const { rows } = await client.query('SELECT 1 FROM job_assessment_problems WHERE job_id = $1 AND problem_id = $2', [jobId, problemId])
  return rows.length > 0
}

/**
 * True if the problem belongs to the assessment of a job the candidate has an ACTIVE application for, or to a hirer-built
 * assessment (migration 018) the candidate is taking right now. Used to withhold hints and the coding coach.
 */
async function isProblemInActiveAssessmentFor(candidateId, problemId, activeStatuses, client = pool) {
  const { rows } = await client.query(
    `SELECT 1 FROM applications a JOIN job_assessment_problems jap ON jap.job_id = a.job_id
      WHERE a.candidate_id = $1 AND jap.problem_id = $2 AND a.status = ANY($3::text[])
     UNION ALL
     SELECT 1 FROM assessment_attempts t
       JOIN assessment_sections s ON s.assessment_id = t.assessment_id
       JOIN assessment_items i ON i.section_id = s.id
      WHERE t.candidate_id = $1 AND t.status = 'in_progress' AND i.coding_problem_id = $2
     LIMIT 1`,
    [candidateId, problemId, activeStatuses],
  )
  return rows.length > 0
}

async function countAttempts(applicationId, problemId, client = pool) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM coding_submissions WHERE application_id = $1 AND problem_id = $2',
    [applicationId, problemId],
  )
  return rows[0].n
}

async function getInterviewSessionForApplication(applicationId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, status, interview_type, difficulty, final_score, started_at, completed_at
       FROM interview_sessions WHERE application_id = $1`,
    [applicationId],
  )
  return rows[0] || null
}

/** Per configured problem: attempts and the best submission (passed first, then most tests passed, then newest). */
async function getCodingProgress(applicationId, jobId, client = pool) {
  const { rows } = await client.query(
    `SELECT cp.id AS problem_id, cp.title, cp.difficulty, jap.position,
            COALESCE(att.attempts, 0) AS attempts,
            best.id AS best_submission_id, best.status AS best_status,
            best.test_cases_passed AS best_passed, best.test_cases_total AS best_total,
            best.language AS best_language, best.submitted_at AS last_submitted_at
       FROM job_assessment_problems jap
       JOIN coding_problems cp ON cp.id = jap.problem_id
       LEFT JOIN (SELECT problem_id, count(*)::int AS attempts FROM coding_submissions
                   WHERE application_id = $1 GROUP BY problem_id) att ON att.problem_id = cp.id
       LEFT JOIN LATERAL (
              SELECT cs.id, cs.status, cs.test_cases_passed, cs.test_cases_total, cs.language, cs.submitted_at
                FROM coding_submissions cs
               WHERE cs.application_id = $1 AND cs.problem_id = cp.id
               ORDER BY (cs.status = 'passed') DESC, cs.test_cases_passed DESC, cs.submitted_at DESC, cs.id DESC
               LIMIT 1) best ON true
      WHERE jap.job_id = $2
      ORDER BY jap.position, cp.id`,
    [applicationId, jobId],
  )
  return rows
}

async function getProgress(applicationId, jobId, client = pool) {
  const config = await getConfig(jobId, client)
  const interviewSession = await getInterviewSessionForApplication(applicationId, client)
  const coding = await getCodingProgress(applicationId, jobId, client)
  return { config, interviewSession, coding }
}

module.exports = {
  getConfig, hasActivity, countExistingProblems, upsertConfig, replaceProblems, isProblemInJobAssessment,
  countAttempts, getInterviewSessionForApplication, getCodingProgress, getProgress, isProblemInActiveAssessmentFor,
}
