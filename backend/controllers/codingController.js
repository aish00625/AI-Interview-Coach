const { sendSuccess, notImplemented } = require('../utils/apiResponse')
const codingService = require('../services/codingService')
const codingModel = require('../models/codingModel')

/**
 * Thin controllers — orchestration lives in services/codingService.js,
 * queries in models/codingModel.js. Every user-specific function uses
 * req.user.userId (set by requireAuth), never a client-supplied id.
 *
 * Phase 8: problem browsing + submission PERSISTENCE only — nothing here
 * executes code. runCode/submitCode remain 501 placeholders reserved for
 * Phase 9's actual Docker-backed execution; POST /submissions (below) is
 * the Phase 8 "save my code" endpoint, a deliberately different concept.
 */

async function getCodingProblems(req, res, next) {
  try {
    const { topic, difficulty, search } = req.query
    const problems = await codingService.getProblems({ topic, difficulty, search })
    sendSuccess(res, problems)
  } catch (err) {
    next(err)
  }
}

async function getCodingProblem(req, res, next) {
  try {
    const problem = await codingService.getProblemDetail(Number(req.params.id))
    sendSuccess(res, problem)
  } catch (err) {
    next(err)
  }
}

/** Phase I: runs against the problem's sample tests only; nothing is saved and no assessment attempt is used. */
async function runCode(req, res, next) {
  try {
    const { problemId, language, sourceCode } = req.body
    sendSuccess(res, await codingService.runCode({ problemId: Number(problemId), language, sourceCode }))
  } catch (err) {
    next(err)
  }
}

async function getHints(req, res, next) {
  try {
    sendSuccess(res, await codingService.getHints({ userId: req.user.userId, problemId: Number(req.params.id) }))
  } catch (err) {
    next(err)
  }
}

async function revealNextHint(req, res, next) {
  try {
    sendSuccess(res, await codingService.revealNextHint({ userId: req.user.userId, problemId: Number(req.params.id) }))
  } catch (err) {
    next(err)
  }
}

async function submitCode(req, res) {
  notImplemented(res, 'Submitting code for execution/grading is implemented in Phase 9 (Docker execution service). To save a submission without executing it, use POST /api/coding/submissions.')
}

/** Phase 8: stores the submission (status "pending"); does not execute it. */
async function createSubmission(req, res, next) {
  try {
    const { problemId, language, sourceCode, sessionId, applicationId } = req.body
    const submission = await codingService.createSubmission({
      userId: req.user.userId, problemId, language, sourceCode, sessionId, applicationId,
    })
    sendSuccess(res, submission, 201)
  } catch (err) {
    next(err)
  }
}

async function getSubmission(req, res, next) {
  try {
    const submission = await codingService.getSubmissionDetail(Number(req.params.id), req.user.userId)
    sendSuccess(res, submission)
  } catch (err) {
    next(err)
  }
}

/** User-specific — always scoped to the authenticated user, never a client-supplied id. */
async function getMySubmissions(req, res, next) {
  try {
    const submissions = await codingService.getUserSubmissions(req.user.userId)
    sendSuccess(res, submissions)
  } catch (err) {
    next(err)
  }
}

async function getMyProgress(req, res, next) {
  try {
    sendSuccess(res, { progress: await codingModel.getProgressByProblem(req.user.userId) })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getMyProgress,
  getCodingProblems, getCodingProblem, runCode, getHints, revealNextHint, submitCode,
  createSubmission, getSubmission, getMySubmissions,
}
