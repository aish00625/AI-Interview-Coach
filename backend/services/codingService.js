const codingModel = require('../models/codingModel')
const assessmentService = require('./assessmentService')
const assessmentModel = require('../models/assessmentModel')
const codeExecutorClient = require('./codeExecutorClient')
const codingHintModel = require('../models/codingHintModel')
const { explainFailure, summarizeRun, sanitizeProgramText } = require('../utils/testFeedback')
const { getStarterCode, SUPPORTED_LANGUAGES } = require('./codingStarterTemplates')

/**
 * Coding module orchestration — same layering pattern as
 * interviewService.js (controller → service → model). Problem
 * browsing/starter code is unchanged from Phase 8. Submission handling
 * is new in Phase 9: it now actually executes the code (inside Docker,
 * via the code-executor service) instead of just persisting it.
 */

function notFoundError(message) {
  const err = new Error(message)
  err.statusCode = 404
  return err
}

async function getProblems(filters) {
  return codingModel.getAllProblems(filters)
}

/** Attaches generic starter code + the supported-language list — not stored per-problem in the DB, see codingStarterTemplates.js. */
async function getProblemDetail(id) {
  const problem = await codingModel.getProblemById(id)
  if (!problem) throw notFoundError('Coding problem not found.')
  const hints = await codingHintModel.getHints(id)
  return { ...problem, starterCode: getStarterCode(), supportedLanguages: SUPPORTED_LANGUAGES, hintCount: hints ? hints.length : 0 }
}

/**
 * Maps the executor's richer status vocabulary down to the 4 values
 * coding_submissions.status actually allows (see database/schema.sql's
 * CHECK constraint) — never invents a 5th value.
 */
function toDbStatus(executionStatus, passedTests, totalTests) {
  if (executionStatus === 'completed') {
    return passedTests === totalTests && totalTests > 0 ? 'passed' : 'failed'
  }
  return 'error' // compilation_error / runtime_error / timeout / memory_limit / output_limit / execution_error
}

/** Generic, authored tip - contains no test data. Only says whether the failures are in sample or hidden tests. */
function submissionFeedback(status, tests, visibilityByIndex) {
  if (status !== 'completed') return null
  const failed = tests.filter((t) => !t.passed)
  if (!failed.length) return 'All tests passed.'
  const failedVisible = failed.filter((t) => visibilityByIndex[t.index - 1]).length
  const failedHidden = failed.length - failedVisible
  if (failedVisible) return 'Some sample tests failed. Use Run Code to see the expected and actual output for them.'
  return `All sample tests pass but ${failedHidden} hidden test(s) fail. Hidden tests usually cover edge cases: empty or minimum input, the largest allowed input (time limit), duplicates and negative values.`
}

/**
 * Design (documented per Phase 9 spec §22): the row is created with
 * status "pending" and that INSERT commits immediately — no PostgreSQL
 * transaction is held open while waiting on Docker, since that could
 * block other queries for however long execution takes. The row is then
 * updated with the final result in a second, separate statement once
 * execution completes.
 *
 * If the executor is unavailable (network error, timeout, or an invalid
 * response), this function does NOT update the row — it stays "pending"
 * — and lets the 503 from codeExecutorClient propagate. That is a
 * different condition from "the user's code failed": a 503 here means
 * we don't know the outcome, not that we know it failed. The frontend
 * distinguishes these (see CodingEnvironment.jsx).
 */
async function createSubmission({ userId, problemId, sessionId, applicationId, language, sourceCode }) {
  const problem = await codingModel.getProblemById(problemId)
  if (!problem) throw notFoundError('Coding problem not found.')

  // Optional (Phase D): a hiring-assessment attempt. Ownership, active application, problem membership and the
  // attempt cap are all verified server-side; without applicationId this is ordinary private practice, unchanged.
  if (applicationId) await assessmentService.assertCanSubmitCoding({ candidateId: userId, applicationId, problemId })

  const submission = await codingModel.createSubmission({
    userId, problemId, sessionId, applicationId: applicationId ?? null, language, sourceCode, status: 'pending',
  })

  // Test cases are read here, server-side, from PostgreSQL — the request
  // body from the frontend has no testCases field at all (see
  // createSubmissionRules in middleware/validators.js), so there is no
  // way for a client to supply or override them.
  const rawTestCases = await codingModel.getProblemTestCases(problemId)
  const testCases = rawTestCases.map((tc) => toExecutorCase(tc))
  // Which positions are public sample tests (executor results are in the same order). Booleans only - no test data.
  const visibilityByIndex = rawTestCases.map((tc) => isVisibleTest(tc))

  // Any failure here (network/timeout/invalid shape) throws a 503 and
  // deliberately leaves `submission` as "pending" in the database — see
  // the docstring above.
  const executionResult = await codeExecutorClient.executeCode({
    language,
    sourceCode,
    testCases,
  })

  const dbStatus = toDbStatus(executionResult.status, executionResult.passedTests, executionResult.totalTests)
  const updated = await codingModel.updateSubmissionResult(submission.id, {
    status: dbStatus,
    testCasesPassed: executionResult.passedTests,
    testCasesTotal: executionResult.totalTests,
    executionTimeMs: executionResult.executionTimeMs,
    memoryUsedKb: executionResult.memoryUsedKb,
  })

  // executionStatus/tests/stderr are NOT persisted (no columns for them
  // beyond the coarse `status`) — they're included here only for this
  // immediate response, so the frontend can show something more specific
  // than "error" right after submitting. A later GET of this same
  // submission will only show the coarser persisted status.
  return {
    ...updated,
    executionStatus: executionResult.status,
    tests: executionResult.tests.map((t) => ({ index: t.index, passed: t.passed, visible: Boolean(visibilityByIndex[t.index - 1]) })),
    stderr: sanitizeProgramText(executionResult.stderr),
    feedback: submissionFeedback(executionResult.status, executionResult.tests, visibilityByIndex),
  }
}

const isVisibleTest = (tc) => !tc.is_hidden
const toExecutorCase = (tc, extra = {}) => ({ input: tc.input ?? '', expectedOutput: tc.expected_output ?? '', ...extra })

/**
 * Run Code (Phase I). Executes the code against the problem's VISIBLE sample tests only and returns detailed feedback.
 * Nothing is written to the database: no submission row, no assessment attempt consumed. Hidden test inputs and
 * expected outputs never leave the server; the visible tests' inputs/expected outputs are already public in the
 * problem's examples and are flagged returnOutput so the executor echoes the program's actual output for them.
 *
 * Unlike createSubmission this has no applicationId: it is available during a job assessment (the sample tests are
 * public anyway) but is never recorded, so the hiring team sees only real submissions.
 */
async function runCode({ problemId, language, sourceCode }) {
  const problem = await codingModel.getProblemById(problemId)
  if (!problem) throw notFoundError('Coding problem not found.')

  const visible = (await codingModel.getProblemTestCases(problemId)).filter(isVisibleTest)
  if (!visible.length) {
    const err = new Error('This problem has no sample tests to run. Use Submit to run it against its test cases.')
    err.statusCode = 422
    throw err
  }

  const result = await codeExecutorClient.executeCode({
    language,
    sourceCode,
    testCases: visible.map((tc) => toExecutorCase(tc, { returnOutput: true })),
  })

  const byIndex = new Map(result.tests.map((t) => [t.index, t]))
  const tests = visible.map((tc, i) => {
    const index = i + 1
    const r = byIndex.get(index)
    const ran = Boolean(r)
    const passed = ran ? r.passed : false
    const timedOut = result.status === 'timeout' && ran && r.actualOutput == null && !passed
    const explanation = ran
      ? explainFailure({ expected: tc.expected_output ?? '', actual: r.actualOutput ?? null, stderr: r.stderr, timedOut, passed })
      : { category: 'not_run', message: 'This test was not run because an earlier problem stopped the run.', diff: null }
    return {
      index,
      passed,
      ran,
      input: tc.input ?? '',
      expectedOutput: tc.expected_output ?? '',
      actualOutput: ran ? (r.actualOutput ?? null) : null,
      durationMs: ran ? (r.durationMs ?? null) : null,
      explanation,
    }
  })

  return {
    status: result.status,
    passedTests: tests.filter((t) => t.passed).length,
    totalTests: tests.length,
    executionTimeMs: result.executionTimeMs,
    // The executor does not measure memory, so this is honestly null; per-test durationMs is wall-clock time
    // measured around each run step (includes container exec overhead), not pure CPU time.
    memoryUsedKb: result.memoryUsedKb ?? null,
    stderr: sanitizeProgramText(result.stderr),
    summary: summarizeRun({ status: result.status, stderr: result.stderr, tests }),
    tests,
    recorded: false,
  }
}

const HINTS_LOCKED_MESSAGE = 'Hints are not available for problems that are part of a job assessment you are currently taking.'

/** The id lookup + hints-locked check shared by both hint endpoints. */
async function _loadHintContext(userId, problemId) {
  const hints = await codingHintModel.getHints(problemId)
  if (hints === null) throw notFoundError('Coding problem not found.')
  const locked = await assessmentModel.isProblemInActiveAssessmentFor(userId, problemId, assessmentService.ACTIVE_APPLICATION_STATUSES)
  return { hints, locked }
}

/** Already-revealed hints only. Later hints are never included, and a locked problem returns none at all. */
async function getHints({ userId, problemId }) {
  const { hints, locked } = await _loadHintContext(userId, problemId)
  if (locked) return { total: hints.length, locked: true, message: HINTS_LOCKED_MESSAGE, revealed: [] }
  const levels = await codingHintModel.getRevealedLevels(userId, problemId)
  return {
    total: hints.length, locked: false,
    revealed: levels.filter((l) => l <= hints.length).map((l) => ({ level: l, text: hints[l - 1] })),
  }
}

/** Reveals exactly the next unrevealed level (1, then 2, ...). Repeating the call after the last level returns the same state. */
async function revealNextHint({ userId, problemId }) {
  const { hints, locked } = await _loadHintContext(userId, problemId)
  if (locked) {
    const err = new Error(HINTS_LOCKED_MESSAGE)
    err.statusCode = 403
    throw err
  }
  if (!hints.length) {
    const err = new Error('This problem has no hints.')
    err.statusCode = 404
    throw err
  }
  const levels = await codingHintModel.getRevealedLevels(userId, problemId)
  const next = levels.length ? Math.max(...levels) + 1 : 1
  if (next <= hints.length) await codingHintModel.recordReveal(userId, problemId, next)
  return getHints({ userId, problemId })
}

/** Ownership-checked: 404 (not 403) on a mismatch, so the response never confirms a submission id belongs to someone else. */
async function getSubmissionDetail(id, userId) {
  const submission = await codingModel.getSubmissionById(id)
  if (!submission || submission.user_id !== userId) throw notFoundError('Submission not found.')
  return submission
}

async function getUserSubmissions(userId) {
  return codingModel.getSubmissionsByUser(userId)
}

module.exports = { getProblems, getProblemDetail, runCode, getHints, revealNextHint, createSubmission, getSubmissionDetail, getUserSubmissions }
