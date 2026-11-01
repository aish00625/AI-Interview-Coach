const interviewModel = require('../models/interviewModel')
const followUpModel = require('../models/followUpModel')
const aiFeedbackModel = require('../models/aiFeedbackModel')
const codingModel = require('../models/codingModel')
const assessmentModel = require('../models/assessmentModel')
const assessmentService = require('./assessmentService')
const codingService = require('./codingService')
const preparationService = require('./preparationService')
const localAi = require('./localAiClient')
const { ruleBasedStar } = require('../utils/starRules')
const { ruleBasedReport } = require('../utils/reportRules')
const { buildDailyPlan } = require('../utils/dailyPlan')

/**
 * Orchestration for the local-AI features (multi-turn follow-ups, STAR coaching, code coaching, final report, daily plan).
 *
 * Rules that hold for every function here (each is covered by a test):
 *   - the caller's ownership of the session is verified first, and a session that is not theirs is a 404;
 *   - these are PRIVATE PRACTICE features: a hiring-assessment session (application_id set) is refused, so every applicant
 *     to a job is treated identically and nothing AI-generated can reach a hirer;
 *   - the model only ever produces advisory text. It cannot create or change a score, a pass/fail result, a final score
 *     or an application status, and its output is never written to interview_answers or coding_submissions;
 *   - if the model is unavailable the rule-based alternative is used and labelled `source: 'rule_based'`; a feature with
 *     no rule-based alternative (follow-ups after the first authored prompt) simply reports `available: false`.
 */

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode })
const MAX_TURNS = Math.min(3, Math.max(1, Number(process.env.FOLLOWUP_MAX_TURNS) || 2))
const ADVISORY = 'AI-generated feedback is advisory. It does not change your scores and is never shown to employers.'

const textOf = (answer) => (answer ? (answer.answer_text || answer.audio_transcript || '').trim() : '')
const unavailable = (err) => ({ reason: err.reason || 'llm_error', message: err.message || 'The local AI model is not available right now.', retryable: err.retryable !== false })

async function loadPracticeSession(sessionId, userId) {
  const session = await interviewModel.getSessionById(sessionId)
  if (!session || session.user_id !== userId) throw httpError(404, 'Interview session not found.')
  if (session.application_id) throw httpError(403, 'AI follow-ups and coaching are only available in practice interviews, not in hiring assessments.')
  return session
}

async function loadQuestionWithAnswer(session, questionId) {
  if (!(await interviewModel.verifyQuestionBelongsToSession(questionId, session.id))) throw httpError(404, 'That question does not belong to this interview session.')
  const question = await interviewModel.getQuestionById(questionId)
  const answer = await interviewModel.getAnswerByQuestion(questionId)
  return { question, answer }
}

/* ------------------------------ status ------------------------------ */

async function getStatus() {
  const s = await localAi.getStatus()
  return {
    ...s,
    features: ['multi-turn follow-up questions', 'STAR coaching', 'coding coach', 'interview report'],
    fallback: 'When the model is unavailable these features use simpler rule-based logic or are hidden, and the app keeps working.',
    advisory: ADVISORY,
  }
}

/* ------------------------------ multi-turn follow-ups ------------------------------ */

/**
 * Creates (or returns the open) next follow-up turn for an ANSWERED main question of an in-progress practice interview.
 * Returns { available: true, followUp } or { available: false, reason, message } - never an error just because the model is down.
 */
async function requestFollowUp({ userId, sessionId, questionId }) {
  const session = await loadPracticeSession(sessionId, userId)
  if (session.status !== 'in_progress') throw httpError(409, 'Follow-up questions are only asked while the interview is in progress.')
  const { question, answer } = await loadQuestionWithAnswer(session, questionId)
  if (!answer) throw httpError(409, 'Answer the question first; the follow-up is based on your answer.')
  const answerText = textOf(answer)
  if (!answerText) throw httpError(409, 'There is no answer text to follow up on.')

  const turns = await followUpModel.listForQuestion(questionId)
  const last = turns[turns.length - 1]
  if (last && last.status === 'open') return { available: true, followUp: last, created: false, maxTurns: MAX_TURNS }
  if (last && last.status === 'skipped') throw httpError(409, 'You skipped the follow-up for this question.')
  if (turns.length >= MAX_TURNS) throw httpError(409, `This question already has the maximum of ${MAX_TURNS} follow-up${MAX_TURNS === 1 ? '' : 's'}.`)

  const meta = answer.evaluation_meta || {}
  const turnNo = turns.length + 1
  let created = null
  let why = null
  try {
    const out = await localAi.followUp({
      question: question.question_text, answer: answerText,
      interviewType: session.interview_type, difficulty: session.difficulty, targetRole: session.target_role,
      missingCriteria: Array.isArray(meta.missingCriteria) ? meta.missingCriteria : [],
      previousTurns: turns.filter((t) => t.status === 'answered').map((t) => ({ prompt: t.prompt, answer: t.answerText || '' })),
    })
    created = await followUpModel.create({ sessionId: session.id, questionId, turnNo, prompt: out.prompt, source: 'local_ai', model: out.model, reason: out.reason })
  } catch (err) {
    why = unavailable(err)
    // Rule-based alternative: the prompts authored in the question bank for criteria the answer did not cover (first turn only).
    const authored = turnNo === 1 && Array.isArray(meta.followUps) ? meta.followUps.filter((f) => typeof f === 'string' && f.trim()) : []
    if (authored.length) {
      created = await followUpModel.create({ sessionId: session.id, questionId, turnNo, prompt: authored[0].slice(0, 300), source: 'rule_based', model: null, reason: 'Your answer did not cover this point.' })
    }
  }
  if (!created) {
    // Either the model failed and there is no authored prompt, or a concurrent request created the same turn.
    const again = await followUpModel.listForQuestion(questionId)
    const open = again.find((t) => t.status === 'open')
    if (open) return { available: true, followUp: open, created: false, maxTurns: MAX_TURNS }
    return { available: false, ...(why || { reason: 'no_follow_up', message: 'No follow-up question is available for this answer.', retryable: false }) }
  }
  return { available: true, followUp: created, created: true, maxTurns: MAX_TURNS }
}

async function loadOwnedFollowUp(followUpId, userId, sessionId) {
  const fu = await followUpModel.getById(followUpId)
  if (!fu || (sessionId != null && fu.sessionId !== sessionId)) throw httpError(404, 'Follow-up not found.')
  const session = await interviewModel.getSessionById(fu.sessionId)
  if (!session || session.user_id !== userId) throw httpError(404, 'Follow-up not found.')
  if (session.application_id) throw httpError(403, 'AI follow-ups are only available in practice interviews.')
  return { fu, session }
}

async function answerFollowUp({ userId, sessionId, followUpId, answerText }) {
  const { fu, session } = await loadOwnedFollowUp(followUpId, userId, sessionId)
  const text = String(answerText || '').trim()
  if (!text) throw httpError(400, 'Please write an answer or choose to skip.')
  if (text.length > 4000) throw httpError(400, 'Answers can be at most 4000 characters.')
  if (fu.status !== 'open') throw httpError(409, 'This follow-up has already been answered or skipped.')
  if (session.status !== 'in_progress') throw httpError(409, 'The interview is already finished.')

  let feedback = null
  let feedbackNote = null
  if (fu.source === 'local_ai') {
    try {
      const out = await localAi.followUpFeedback({ prompt: fu.prompt, answer: text, interviewType: session.interview_type })
      feedback = { source: 'local_ai', model: out.model, text: out.feedback, strength: out.strength, improve: out.improve, advisory: ADVISORY }
    } catch (err) { feedbackNote = unavailable(err) }
  }
  const saved = await followUpModel.markAnswered(fu.id, text, feedback)
  if (!saved) throw httpError(409, 'This follow-up has already been answered or skipped.')
  const turns = await followUpModel.listForQuestion(fu.questionId)
  return { followUp: saved, feedbackUnavailable: feedbackNote, canAskAnother: turns.length < MAX_TURNS, maxTurns: MAX_TURNS }
}

async function skipFollowUp({ userId, sessionId, followUpId }) {
  const { fu } = await loadOwnedFollowUp(followUpId, userId, sessionId)
  if (fu.status !== 'open') throw httpError(409, 'This follow-up has already been answered or skipped.')
  const saved = await followUpModel.markSkipped(fu.id)
  if (!saved) throw httpError(409, 'This follow-up has already been answered or skipped.')
  return { followUp: saved }
}

/** All follow-up turns of one of the caller's practice sessions (empty for hiring assessments). */
async function listForSession(session) {
  if (session.application_id) return []
  return followUpModel.listForSession(session.id)
}

/* ------------------------------ STAR coaching ------------------------------ */

const starNote = 'STAR feedback is advisory. Evidence quotes come from your own answer; a missing part may simply be worded differently.'

async function getSavedStar({ userId, sessionId, questionId }) {
  const session = await loadPracticeSession(sessionId, userId)
  await loadQuestionWithAnswer(session, questionId)
  const saved = await aiFeedbackModel.get(userId, 'star', questionId)
  return saved ? { saved: true, ...saved.payload, source: saved.source, model: saved.model, createdAt: saved.createdAt } : { saved: false }
}

async function generateStar({ userId, sessionId, questionId }) {
  const session = await loadPracticeSession(sessionId, userId)
  const { question, answer } = await loadQuestionWithAnswer(session, questionId)
  const text = textOf(answer)
  if (!text) throw httpError(409, 'Answer the question first; STAR coaching analyses your answer.')

  let payload; let source; let model = null; let why = null
  try {
    const out = await localAi.star({ question: question.question_text, answer: text })
    payload = { elements: out.elements, overall: out.overall, evidenceDropped: out.evidenceDropped }
    source = 'local_ai'; model = out.model
  } catch (err) {
    why = unavailable(err)
    const r = ruleBasedStar(text)
    payload = { elements: r.elements, overall: r.overall, evidenceDropped: 0 }
    source = 'rule_based'
  }
  payload.missing = Object.keys(payload.elements).filter((k) => payload.elements[k].status === 'missing')
  payload.weak = Object.keys(payload.elements).filter((k) => payload.elements[k].status === 'weak')
  payload.note = starNote
  const row = await aiFeedbackModel.upsert(userId, 'star', questionId, { source, model, payload })
  return { saved: true, ...payload, source, model, createdAt: row.createdAt, ...(why ? { aiUnavailable: why } : {}) }
}

/* ------------------------------ final interview report ------------------------------ */

async function buildReportItems(session) {
  const answers = await interviewModel.getAnswersBySession(session.id)
  const topics = await aiFeedbackModel.getTopicNames(answers.map((a) => a.topic_id))
  return answers.map((a) => {
    const meta = a.evaluation_meta || {}
    const n = (v) => (v == null ? null : Number(v))
    return {
      topic: topics.get(Number(a.topic_id)) || null, question: a.question_text, answer: textOf(a).slice(0, 1500),
      technical: n(a.technical_score), relevance: n(a.relevance_score), clarity: n(a.clarity_score), completeness: n(a.completeness_score),
      matched: Array.isArray(meta.matchedCriteria) ? meta.matchedCriteria : [], missing: Array.isArray(meta.missingCriteria) ? meta.missingCriteria : [],
    }
  })
}

async function getSavedReport({ userId, sessionId }) {
  await loadPracticeSession(sessionId, userId)
  const saved = await aiFeedbackModel.get(userId, 'interview_report', sessionId)
  return saved ? { saved: true, report: saved.payload, source: saved.source, model: saved.model, createdAt: saved.createdAt, advisory: ADVISORY } : { saved: false }
}

async function generateReport({ userId, sessionId }) {
  const session = await loadPracticeSession(sessionId, userId)
  if (session.status !== 'completed') throw httpError(409, 'Finish the interview first; the report covers the whole interview.')
  const items = await buildReportItems(session)
  const finalScore = session.final_score == null ? null : Number(session.final_score)
  let report; let source; let model = null; let why = null
  try {
    const out = await localAi.report({ interviewType: session.interview_type, targetRole: session.target_role, difficulty: session.difficulty, finalScore, items })
    report = { summary: out.summary, strengths: out.strengths, improvements: out.improvements, nextSteps: out.nextSteps }
    source = 'local_ai'; model = out.model
  } catch (err) {
    why = unavailable(err)
    report = ruleBasedReport({ items, finalScore })
    source = 'rule_based'
  }
  const row = await aiFeedbackModel.upsert(userId, 'interview_report', sessionId, { source, model, payload: report })
  return { saved: true, report, source, model, createdAt: row.createdAt, advisory: ADVISORY, ...(why ? { aiUnavailable: why } : {}) }
}

/* ------------------------------ coding coach ------------------------------ */

const LOCKED_MESSAGE = 'The coding coach is not available for problems that are part of a job assessment you are currently taking.'

/**
 * Runs the code against the VISIBLE sample tests in the Docker executor (the only authority on pass/fail), then asks the
 * model to explain the result. Hidden tests, reference solutions and other users' code never reach the model. The AI
 * response is returned next to - never merged into - the executor's result.
 */
async function coachCode({ userId, problemId, language, sourceCode }) {
  const problem = await codingModel.getProblemById(problemId)
  if (!problem) throw httpError(404, 'Coding problem not found.')
  if (await assessmentModel.isProblemInActiveAssessmentFor(userId, problemId, assessmentService.ACTIVE_APPLICATION_STATUSES)) throw httpError(403, LOCKED_MESSAGE)

  const run = await codingService.runCode({ problemId, language, sourceCode })

  let coaching; let why = null
  try {
    const out = await localAi.codeCoach({
      title: problem.title, statement: problem.description, language, code: sourceCode, status: run.status,
      tests: run.tests.filter((t) => t.ran).map((t) => ({ index: t.index, passed: t.passed, input: t.input, expected: t.expectedOutput, actual: t.actualOutput, note: t.explanation && t.explanation.message })),
      stderr: run.stderr || '',
    })
    coaching = { source: 'local_ai', model: out.model, summary: out.summary, failureExplanation: out.failureExplanation, hints: out.hints, edgeCases: out.edgeCases, complexity: out.complexity }
  } catch (err) {
    why = unavailable(err)
    const failing = run.tests.filter((t) => t.ran && !t.passed)
    coaching = {
      source: 'rule_based', model: null, summary: run.summary,
      failureExplanation: failing.length ? failing.slice(0, 3).map((t) => `Test ${t.index}: ${t.explanation && t.explanation.message}`).join(' ') : null,
      hints: [], edgeCases: [], complexity: null,
    }
  }
  return {
    run,
    coaching: { ...coaching, advisory: 'AI feedback is advisory. The pass/fail results above come from running your code and cannot be changed by the AI.' },
    ...(why ? { aiUnavailable: why } : {}),
  }
}

/* ------------------------------ daily plan ------------------------------ */

async function getDailyPlan(userId, now = new Date()) {
  const prep = await preparationService.getPreparation(userId, now)
  return { generatedAt: now.toISOString(), ...buildDailyPlan(prep) }
}

module.exports = {
  getStatus, requestFollowUp, answerFollowUp, skipFollowUp, listForSession,
  getSavedStar, generateStar, getSavedReport, generateReport, coachCode, getDailyPlan, MAX_TURNS, ADVISORY,
}
