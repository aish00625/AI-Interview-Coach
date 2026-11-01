const { pool } = require('../config/db')
const interviewModel = require('../models/interviewModel')
const followUpModel = require('../models/followUpModel')
const questionService = require('./interviewQuestionService')
const aiServiceClient = require('./aiServiceClient')
const practiceInsightModel = require('../models/practiceInsightModel')
const profileModel = require('../models/profileModel')
const { sanitizeTypingMetrics } = require('../utils/typingMetrics')
const { computeBehaviorSummary, summarizeSession } = require('../utils/behaviorScoring')
const { buildCombinedSummary } = require('../utils/combinedSummary')
const { computeScoreBreakdown, loadWeights } = require('../utils/scoreModel')
const { adaptDifficulty } = require('../utils/questionSelector')

function notFoundError(message = 'Interview session not found.') {
  const err = new Error(message)
  err.statusCode = 404
  return err
}

function conflictError(message) {
  const err = new Error(message)
  err.statusCode = 409
  return err
}

/**
 * Creates a session and its questions together, in one transaction, so a
 * failure partway through (e.g. question insertion fails) never leaves a
 * session with zero questions sitting in the database.
 */
async function createInterviewSession({ userId, interviewType, targetRole, difficulty, applicationId = null, personalize = false, adaptive = false }) {
  // Personalisation and adaptive difficulty are PRIVATE PRACTICE features. A hiring assessment (applicationId set)
  // ignores both flags so every applicant to a job receives the same questions at the same difficulty.
  const practiceOnlyOptions = !applicationId && (personalize || adaptive)

  let appliedDifficulty = difficulty
  let personalization = null
  let personalizationInfo = null
  if (practiceOnlyOptions) {
    let adaptation = null
    if (adaptive) {
      adaptation = adaptDifficulty({ requested: difficulty, recentScores: await practiceInsightModel.getRecentPracticeScores(userId, interviewType, 3) })
      appliedDifficulty = adaptation.difficulty
    }
    if (personalize) {
      const [profile, skills, weakTopics, recentTexts] = await Promise.all([
        profileModel.getProfileByUserId(userId),
        profileModel.getUserSkills(userId),
        practiceInsightModel.getTopicPerformance(userId),
        practiceInsightModel.getRecentQuestionTexts(userId, 3),
      ])
      personalization = { profile: { skills: skills.map((s) => s.name), targetRole: profile?.target_role || targetRole }, weakTopics, recentTexts }
    }
    personalizationInfo = {
      personalized: Boolean(personalize), adaptive: Boolean(adaptive),
      difficultyRequested: difficulty, difficultyApplied: appliedDifficulty,
      difficultyReason: adaptation ? adaptation.reason : null,
    }
  }

  const generated = await questionService.generateInterviewQuestions({ interviewType, targetRole, difficulty: appliedDifficulty, personalization })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const session = await interviewModel.createSession({ userId, interviewType, targetRole, difficulty: appliedDifficulty, applicationId }, client)
    const questions = await interviewModel.createQuestions(session.id, generated, client)
    await client.query('COMMIT')
    if (personalizationInfo) {
      personalizationInfo.questionReasons = questions.map((q, i) => ({ questionId: q.id, orderIndex: q.order_index, reasons: generated[i].reasons || [] }))
    }
    return { session, questions, ...(personalizationInfo ? { personalization: personalizationInfo } : {}) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function getUserInterviews(userId, filters) {
  return interviewModel.getUserSessions(userId, filters)
}

/** Ownership-checked: throws a 404 (not a 403) if the session doesn't exist or isn't the caller's. */
async function getInterviewDetail(sessionId, userId) {
  const session = await interviewModel.getSessionById(sessionId)
  if (!session || session.user_id !== userId) throw notFoundError()

  const questions = await interviewModel.getQuestionsBySession(sessionId)
  const answeredIds = new Set(await interviewModel.getAnsweredQuestionIds(sessionId))
  const answers = await interviewModel.getAnswersBySession(sessionId)
  const answerByQuestionId = new Map(answers.map((a) => [a.question_id, a]))

  // The delivery (behaviour) summary is derived on read from the stored measurements, so it can never go stale (for
  // example when a camera clip is attached after the answer). Practice sessions only - never for hiring assessments.
  const isPractice = !session.application_id
  const withBehavior = (a) => {
    if (!a) return null
    if (!isPractice) return a
    return { ...a, behavior_summary: computeBehaviorSummary({ speechMetrics: a.speech_metrics, cvMetrics: a.cv_metrics, typingMetrics: a.typing_metrics }) }
  }

  const questionsWithStatus = questions.map((q) => ({
    ...q,
    answered: answeredIds.has(q.id),
    answer: withBehavior(answerByQuestionId.get(q.id) || null),
  }))

  const delivery = isPractice ? summarizeSession(questionsWithStatus.map((q) => q.answer && q.answer.behavior_summary)) : null
  // Multi-turn follow-ups (practice only). Separate from the scored answers above and never part of any score.
  const followUps = isPractice ? await followUpModel.listForSession(sessionId) : []
  // Content + delivery in one practice summary (completed practice sessions with a delivery score only; advisory, scores untouched).
  const combinedSummary = isPractice && session.status === 'completed' ? buildCombinedSummary({ finalScore: session.score_breakdown ? session.score_breakdown.contentScore : session.final_score, delivery }) : null
  return { session, questions: questionsWithStatus, ...(isPractice ? { followUps } : {}), ...(delivery ? { delivery } : {}), ...(combinedSummary ? { combinedSummary } : {}) }
}

/**
 * Shared precondition checks for both submitAnswer and submitAudioAnswer:
 * session exists and belongs to this user, session isn't already
 * completed, the question actually belongs to this session, and it
 * hasn't been answered yet. Throws the appropriate 404/409 otherwise.
 */
async function _assertCanAnswer(sessionId, userId, questionId) {
  const session = await interviewModel.getSessionById(sessionId)
  if (!session || session.user_id !== userId) throw notFoundError()

  if (session.status === 'completed') {
    throw conflictError('This interview has already been completed; answers can no longer be submitted.')
  }

  const belongs = await interviewModel.verifyQuestionBelongsToSession(questionId, sessionId)
  if (!belongs) throw notFoundError('That question does not belong to this interview session.')

  // An existing answer is no longer an error: while the interview is open the person may go back and answer again. The new attempt
  // replaces the old one (which is kept in the answer's history) - see attemptMeta.
  const existing = await interviewModel.getAnswerByQuestion(questionId)
  const question = await interviewModel.getQuestionById(questionId)
  return { session, question, existing }
}

const MAX_PREVIOUS_ATTEMPTS = 5

/** What is kept of an answer that is being replaced: when, whether it was skipped, its status, a plain average and a short text preview. */
function attemptSnapshot(a) {
  const meta = a.evaluation_meta || {}
  const skipped = meta.skipped === true
  const scores = [a.technical_score, a.relevance_score, a.clarity_score, a.completeness_score].map(Number)
  const average = skipped || scores.some((x) => !Number.isFinite(x)) ? 0 : Math.round(scores.reduce((t, x) => t + x, 0) / 4)
  return {
    at: a.created_at, skipped,
    status: meta.answerQuality && typeof meta.answerQuality.status === 'string' ? meta.answerQuality.status : null,
    average, preview: String(a.answer_text || a.audio_transcript || '').slice(0, 500),
  }
}

/** Adds the retry bookkeeping to the stored evaluation metadata. `existing` is the answer being replaced, or null for a first attempt. */
function attemptMeta(meta, existing) {
  if (!existing) return meta
  const old = (existing.evaluation_meta && existing.evaluation_meta.previousAttempts) || []
  const previousAttempts = [...(Array.isArray(old) ? old : []), attemptSnapshot(existing)].slice(-MAX_PREVIOUS_ATTEMPTS)
  const prevCount = Number(existing.evaluation_meta && existing.evaluation_meta.attemptCount) || 1
  return { ...(meta || {}), attemptCount: prevCount + 1, previousAttempts }
}

async function _nextQuestionAfterAnswering(sessionId) {
  const allQuestions = await interviewModel.getQuestionsBySession(sessionId)
  const answeredIds = new Set(await interviewModel.getAnsweredQuestionIds(sessionId))
  const nextQuestion = allQuestions.find((q) => !answeredIds.has(q.id)) || null
  return { nextQuestion, sessionComplete: !nextQuestion }
}

/**
 * Evaluation metadata to store with an answer. Follow-up prompts are practice-only: in a hiring assessment
 * (session.application_id set) every applicant must be treated identically, so no extra coaching prompts are kept.
 */
function metaForSession(meta, evaluation, session) {
  if (!meta) return null
  if (session.application_id) return meta
  const followUps = Array.isArray(evaluation.followUps) ? evaluation.followUps.filter((f) => typeof f === 'string').slice(0, 3) : []
  return followUps.length ? { ...meta, followUps } : meta
}

/**
 * Sends the answer to the Python AI service for real evaluation, stores
 * the result, and works out what the next unanswered question is (by
 * order_index) — the frontend is never trusted to compute this itself.
 *
 * If the AI service is unavailable or returns something unusable,
 * aiServiceClient.evaluateAnswer throws a 503 — this function lets that
 * propagate rather than storing a fabricated score, so no answer row is
 * ever created from a failed evaluation.
 */
async function submitAnswer({ sessionId, userId, questionId, answerText, typingMetrics }) {
  const { session, question, existing } = await _assertCanAnswer(sessionId, userId, questionId)

  const evaluation = await aiServiceClient.evaluateAnswer({
    questionText: question.question_text,
    answerText,
    targetRole: session.target_role,
    difficulty: session.difficulty,
    interviewType: session.interview_type,
  })

  // Typing telemetry is a private-practice feature: a hiring assessment treats every applicant identically and stores none.
  const typing = session.application_id ? null : sanitizeTypingMetrics(typingMetrics, answerText)
  const answer = await interviewModel.createAnswer({ questionId, answerText, ...evaluation, evaluationMeta: attemptMeta(metaForSession(evaluation.evaluationMeta, evaluation, session), existing), typingMetrics: typing }, { replace: !!existing })
  if (existing) await interviewModel.deleteStarFeedback(userId, questionId)
  const { nextQuestion, sessionComplete } = await _nextQuestionAfterAnswering(sessionId)

  return { answer, nextQuestion, sessionComplete }
}

/**
 * Voice-answer counterpart to submitAnswer — same ownership/duplicate
 * checks (via _assertCanAnswer), but sends audio to Python's
 * /speech-evaluate instead of text to /evaluate. The transcript and all
 * four scores come back from Python; nothing here trusts anything
 * React might have sent about content or scoring — only the raw audio
 * bytes and the question/session context.
 *
 * Same failure philosophy as submitAnswer: if aiServiceClient.evaluateSpeechAnswer
 * throws (Python down, timeout, or an invalid response), that 503
 * propagates and no answer row is created — never a fabricated
 * transcript or fake scores.
 */
async function submitAudioAnswer({ sessionId, userId, questionId, audioBuffer, audioMimeType }) {
  const { session, question, existing } = await _assertCanAnswer(sessionId, userId, questionId)

  const evaluation = await aiServiceClient.evaluateSpeechAnswer({
    audioBuffer,
    audioMimeType,
    questionText: question.question_text,
    targetRole: session.target_role,
    difficulty: session.difficulty,
    interviewType: session.interview_type,
  })

  const { transcript, speechMetrics, ...scores } = evaluation
  const answer = await interviewModel.createAnswer({
    questionId,
    answerText: null,
    audioTranscript: transcript,
    speechMetrics,
    ...scores,
    evaluationMeta: attemptMeta(metaForSession(evaluation.evaluationMeta, evaluation, session), existing),
  }, { replace: !!existing })
  if (existing) await interviewModel.deleteStarFeedback(userId, questionId)
  const { nextQuestion, sessionComplete } = await _nextQuestionAfterAnswering(sessionId)

  return { answer, nextQuestion, sessionComplete }
}

/**
 * Skips a question. A skipped question gets an answer row with four zero scores and a "skipped" status, so it counts as 0 in the
 * session score (the same rule as an answer that could not be evaluated), shows as "Skipped" everywhere, and can still be answered
 * later by going back. Nothing is sent to the AI service. Only a question that has no answer yet can be skipped.
 */
async function skipQuestion({ sessionId, userId, questionId }) {
  const { existing } = await _assertCanAnswer(sessionId, userId, questionId)
  if (existing) throw conflictError('This question already has an answer. Answer it again instead of skipping it.')
  const answer = await interviewModel.createAnswer({
    questionId, answerText: null,
    technicalScore: 0, relevanceScore: 0, clarityScore: 0, completenessScore: 0,
    strengths: [], weaknesses: [], suggestedImprovement: null, modelAnswer: null,
    evaluationMeta: {
      skipped: true,
      answerQuality: { status: 'skipped', label: 'Skipped', reasons: ['You chose to skip this question, so it counts as 0.'] },
    },
  })
  const { nextQuestion, sessionComplete } = await _nextQuestionAfterAnswering(sessionId)
  return { answer, nextQuestion, sessionComplete }
}

/**
 * Visual analysis is a supplementary attachment to an answer that
 * already exists (text or voice) — it does NOT create a new answer, and
 * it does NOT advance the interview in its own right: cv_metrics lives on
 * the same interview_answers row as the content scores, per the existing
 * schema, so there is nothing to create here, only something to update.
 * This deliberately reuses interviewModel.updateAnswerEvaluation — the
 * exact function Phase 7 already uses to attach evaluation fields —
 * passing only cvMetrics (every other field stays untouched via that
 * function's own COALESCE).
 *
 * Ownership/session checks mirror _assertCanAnswer, but the
 * duplicate/existence logic is inverted from the text/audio path: here
 * an answer must ALREADY exist (you can't visually analyze a question
 * you haven't answered yet), and a SECOND video for the same question is
 * rejected as a duplicate exactly like a second text/audio answer would be.
 *
 * nextQuestion/sessionComplete are included in the response (via the same
 * resolver the text/audio paths use) purely for the frontend's
 * convenience — the question was already answered before this call was
 * even allowed, so that resolution is already fixed and unaffected by
 * attaching cv_metrics; it is not recomputed or changed here.
 */
async function submitVideoAnswer({ sessionId, userId, questionId, videoBuffer, videoMimeType }) {
  const session = await interviewModel.getSessionById(sessionId)
  if (!session || session.user_id !== userId) throw notFoundError()

  const belongs = await interviewModel.verifyQuestionBelongsToSession(questionId, sessionId)
  if (!belongs) throw notFoundError('That question does not belong to this interview session.')

  const existingAnswer = await interviewModel.getAnswerByQuestion(questionId)
  if (!existingAnswer) {
    throw notFoundError('Submit a text or voice answer for this question before adding visual analysis.')
  }
  if (existingAnswer.cv_metrics) {
    throw conflictError('Visual analysis has already been recorded for this question.')
  }

  // Pictures of the candidate's face are kept for practice interviews only (the person practising is the one who sees them); a hiring
  // assessment stores the measurements and never the frames, and ANSWER_SNAPSHOTS=off turns them off everywhere.
  const keepSnapshots = !session.application_id && !/^(off|false|0|no)$/i.test(String(process.env.ANSWER_SNAPSHOTS || 'on').trim())
  const cvMetrics = await aiServiceClient.analyzeVideoAnswer({ videoBuffer, videoMimeType, keepSnapshots })
  const answer = await interviewModel.updateAnswerEvaluation(questionId, { cvMetrics })
  const { nextQuestion, sessionComplete } = await _nextQuestionAfterAnswering(sessionId)

  return { answer, nextQuestion, sessionComplete }
}

/**
 * Computes the final score as a transparent, documented formula:
 *   question score  = average of that answer's 4 sub-scores
 *   final score     = average of all question scores, rounded
 * The sub-scores themselves now come from the Phase 7 AI service
 * (aiServiceClient.evaluateAnswer); this aggregation formula is
 * independent of how those sub-scores were produced.
 */
function calculateFinalScore(answers) {
  if (answers.length === 0) return 0
  const questionScores = answers.map((a) => {
    const { technical_score, relevance_score, clarity_score, completeness_score } = a
    return (Number(technical_score) + Number(relevance_score) + Number(clarity_score) + Number(completeness_score)) / 4
  })
  const average = questionScores.reduce((sum, s) => sum + s, 0) / questionScores.length
  return Math.round(average * 100) / 100 // round to 2 decimal places, matching NUMERIC(5,2)
}

/** Content sub-scores + measured signals per answer -> transparent breakdown (weights read from SCORE_WEIGHT_* or defaults). */
function buildPracticeBreakdown(answers) {
  const withBehavior = answers.map((a) => ({
    technical: a.technical_score, relevance: a.relevance_score, clarity: a.clarity_score, completeness: a.completeness_score,
    behavior: computeBehaviorSummary({ speechMetrics: a.speech_metrics, cvMetrics: a.cv_metrics, typingMetrics: a.typing_metrics }),
    cv: a.cv_metrics || null,
    flags: { hasSpeech: !!a.speech_metrics, hasTyping: !!a.typing_metrics, hasCamera: !!a.cv_metrics },
  }))
  const { weights, source, warnings } = loadWeights()
  return computeScoreBreakdown(withBehavior, { weights, source, warnings })
}

async function completeInterviewSession(sessionId, userId) {
  const session = await interviewModel.getSessionById(sessionId)
  if (!session || session.user_id !== userId) throw notFoundError()

  if (session.status === 'completed') {
    throw conflictError('This interview has already been completed.')
  }

  // An unanswered follow-up is simply closed when the interview ends; it never affects the score.
  if (!session.application_id) await followUpModel.skipOpenForSession(sessionId)
  const answers = await interviewModel.getAnswersBySession(sessionId)
  const contentOnly = calculateFinalScore(answers)
  // Practice interviews: content + measured speech / typing / camera signals (see utils/scoreModel.js). Hiring assessments
  // stay content-only. Any failure while measuring falls back to content-only: completing an interview must never break.
  let finalScore = contentOnly
  let breakdown = null
  if (!session.application_id && answers.length) {
    try {
      breakdown = buildPracticeBreakdown(answers)
      finalScore = breakdown.finalScore
    } catch (err) {
      console.error('[score] composite scoring failed; saved content-only score:', err.message)
      breakdown = null
      finalScore = contentOnly
    }
  }

  return interviewModel.updateFinalScore(sessionId, finalScore, breakdown)
}

module.exports = {
  createInterviewSession, getUserInterviews, getInterviewDetail,
  submitAnswer, submitAudioAnswer, submitVideoAnswer, skipQuestion, completeInterviewSession,
}
