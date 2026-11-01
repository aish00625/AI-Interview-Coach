const { pool } = require('../config/db')
const jobModel = require('../models/jobModel')
const assessmentModel = require('../models/assessmentModel')
const applicationModel = require('../models/applicationModel')
const interviewModel = require('../models/interviewModel')
const interviewService = require('./interviewService')

const MAX_ASSESSMENT_PROBLEMS = 5
const MAX_ATTEMPTS_PER_PROBLEM = Number(process.env.MAX_ASSESSMENT_ATTEMPTS) || 5
const ACTIVE_APPLICATION_STATUSES = ['submitted', 'under_review', 'shortlisted']

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/* ---------------------------- hirer: configure ---------------------------- */

async function getJobAssessment({ organizationId, jobId }) {
  const job = await jobModel.getJobForOrg(jobId, organizationId)
  if (!job) throw httpError(404, 'Job not found.')
  const config = await assessmentModel.getConfig(job.id)
  return { ...config, locked: await assessmentModel.hasActivity(job.id) }
}

async function setJobAssessment({ organizationId, jobId, interviewEnabled, interviewType, interviewDifficulty, problemIds }) {
  const ids = [...new Set((problemIds || []).map(Number))]
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) throw httpError(400, 'problemIds must be positive integers.')
  if (ids.length > MAX_ASSESSMENT_PROBLEMS) throw httpError(400, `Choose at most ${MAX_ASSESSMENT_PROBLEMS} coding problems.`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Lock the job row (scoped to the caller's organization) so config changes and first candidate activity can't interleave.
    const { rows } = await client.query('SELECT id FROM job_openings WHERE id = $1 AND organization_id = $2 FOR UPDATE', [jobId, organizationId])
    if (!rows[0]) throw httpError(404, 'Job not found.')
    if (await assessmentModel.hasActivity(jobId, client)) {
      throw httpError(409, 'Candidates have already started this job\'s assessments, so they can no longer be changed.')
    }
    if ((await assessmentModel.countExistingProblems(ids, client)) !== ids.length) throw httpError(400, 'One or more selected coding problems do not exist.')
    await assessmentModel.upsertConfig({
      jobId,
      interviewEnabled: Boolean(interviewEnabled),
      interviewType: interviewType || 'technical',
      interviewDifficulty: interviewDifficulty || 'medium',
    }, client)
    await assessmentModel.replaceProblems(jobId, ids, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getJobAssessment({ organizationId, jobId })
}

/* ---------------------------- candidate ---------------------------- */

/** Shape returned inside the candidate's application detail. */
function summarizeProgress({ config, interviewSession, coding }) {
  return {
    configured: Boolean(config.interview_enabled) || coding.length > 0,
    interview: config.interview_enabled
      ? {
          interviewType: config.interview_type,
          difficulty: config.interview_difficulty,
          sessionId: interviewSession ? interviewSession.id : null,
          status: interviewSession ? interviewSession.status : 'not_started',
          finalScore: interviewSession && interviewSession.final_score != null ? Number(interviewSession.final_score) : null,
        }
      : null,
    coding: coding.map((c) => ({
      problemId: c.problem_id, title: c.title, difficulty: c.difficulty,
      attempts: c.attempts, maxAttempts: MAX_ATTEMPTS_PER_PROBLEM,
      bestStatus: c.best_status || 'not_attempted', bestPassed: c.best_passed, bestTotal: c.best_total,
    })),
  }
}

async function getCandidateProgress({ applicationId, jobId }) {
  return summarizeProgress(await assessmentModel.getProgress(applicationId, jobId))
}

async function loadActiveApplication(candidateId, applicationId) {
  const app = await applicationModel.getByIdForCandidate(applicationId, candidateId)
  if (!app) throw httpError(404, 'Application not found.')
  if (!ACTIVE_APPLICATION_STATUSES.includes(app.status)) {
    throw httpError(409, 'Assessments are only available for active applications.')
  }
  // Job assessment answers and code are shared with the hiring team, so the candidate must have agreed first.
  if (app.consent_assessment_at == null) {
    throw httpError(403, 'Before starting, confirm on your application page that you agree to share your assessment results with the hiring team.')
  }
  return app
}

async function startInterviewAssessment({ candidateId, applicationId }) {
  const app = await loadActiveApplication(candidateId, applicationId)
  const config = await assessmentModel.getConfig(app.job_id)
  if (!config.interview_enabled) throw httpError(404, 'This job has no interview assessment.')

  const existing = await assessmentModel.getInterviewSessionForApplication(app.id)
  if (existing) {
    if (existing.status !== 'in_progress') throw httpError(409, 'You have already completed this interview assessment.')
    const questions = await interviewModel.getQuestionsBySession(existing.id)
    return { session: existing, questions, resumed: true }
  }

  const job = await jobModel.getJobForOrgless(app.job_id)
  const targetRole = String(job.title).slice(0, 100)
  try {
    const { session, questions } = await interviewService.createInterviewSession({
      userId: candidateId, interviewType: config.interview_type, targetRole, difficulty: config.interview_difficulty, applicationId: app.id,
    })
    return { session, questions, resumed: false }
  } catch (err) {
    // Two simultaneous "start" clicks: the unique index on application_id lets exactly one session exist.
    if (err.code === '23505') throw httpError(409, 'The interview assessment has already been started.')
    throw err
  }
}

/**
 * Called by codingService before an assessment submission is saved. Returns nothing; throws 404/409/422.
 */
async function assertCanSubmitCoding({ candidateId, applicationId, problemId }) {
  const app = await loadActiveApplication(candidateId, applicationId)
  if (!(await assessmentModel.isProblemInJobAssessment(app.job_id, problemId))) {
    throw httpError(422, 'That problem is not part of this job\'s assessment.')
  }
  if ((await assessmentModel.countAttempts(app.id, problemId)) >= MAX_ATTEMPTS_PER_PROBLEM) {
    throw httpError(409, `You have used all ${MAX_ATTEMPTS_PER_PROBLEM} attempts for this problem.`)
  }
}

module.exports = {
  getJobAssessment, setJobAssessment, getCandidateProgress, startInterviewAssessment, assertCanSubmitCoding,
  summarizeProgress, MAX_ASSESSMENT_PROBLEMS, MAX_ATTEMPTS_PER_PROBLEM, ACTIVE_APPLICATION_STATUSES,
}
