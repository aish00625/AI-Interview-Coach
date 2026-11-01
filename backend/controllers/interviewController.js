const { sendSuccess } = require('../utils/apiResponse')
const interviewService = require('../services/interviewService')

/**
 * Thin controllers — all orchestration lives in services/interviewService.js,
 * all queries in models/interviewModel.js. Every function uses
 * req.user.userId (set by requireAuth after verifying the JWT) for
 * ownership; a client-supplied id is never trusted.
 */

async function createInterview(req, res, next) {
  try {
    const { interviewType, targetRole, difficulty, personalize, adaptive } = req.body
    // answerMode is accepted (for the frontend's own UI state) but there is
    // no matching column in interview_sessions, so it isn't persisted.
    // personalize/adaptive are opt-in private-practice options (a hiring assessment never goes through this route).
    const { session, questions, personalization } = await interviewService.createInterviewSession({
      userId: req.user.userId, interviewType, targetRole, difficulty,
      personalize: personalize === true, adaptive: adaptive === true,
    })
    sendSuccess(res, { session, questions, ...(personalization ? { personalization } : {}) }, 201)
  } catch (err) {
    next(err)
  }
}

async function getInterviews(req, res, next) {
  try {
    const { status, interviewType } = req.query
    const sessions = await interviewService.getUserInterviews(req.user.userId, { status, interviewType })
    sendSuccess(res, sessions)
  } catch (err) {
    next(err)
  }
}

async function getInterview(req, res, next) {
  try {
    const detail = await interviewService.getInterviewDetail(Number(req.params.id), req.user.userId)
    sendSuccess(res, detail)
  } catch (err) {
    next(err)
  }
}

async function submitAnswer(req, res, next) {
  try {
    const { questionId, answerText, typingMetrics } = req.body
    const result = await interviewService.submitAnswer({
      sessionId: Number(req.params.id), userId: req.user.userId, questionId, answerText, typingMetrics,
    })
    sendSuccess(res, result, 201)
  } catch (err) {
    next(err)
  }
}

async function skipQuestion(req, res, next) {
  try {
    const result = await interviewService.skipQuestion({ sessionId: Number(req.params.id), userId: req.user.userId, questionId: Number(req.body.questionId) })
    sendSuccess(res, result, 201)
  } catch (err) {
    next(err)
  }
}

/**
 * The audio file itself is required by uploadAudio + requireAudioFile
 * middleware before this ever runs (see routes/interviewRoutes.js), so
 * req.file is guaranteed present here. questionId arrives as a multipart
 * form field (a string) — Number(...) it the same way the text-answer
 * path does for its JSON body field.
 */
async function submitAudioAnswer(req, res, next) {
  try {
    const { questionId } = req.body
    const result = await interviewService.submitAudioAnswer({
      sessionId: Number(req.params.id),
      userId: req.user.userId,
      questionId: Number(questionId),
      audioBuffer: req.file.buffer,
      audioMimeType: req.file.mimetype,
    })
    sendSuccess(res, result, 201)
  } catch (err) {
    next(err)
  }
}

/**
 * The video file itself is required by uploadVideo + requireVideoFile
 * middleware before this ever runs (see routes/interviewRoutes.js), so
 * req.file is guaranteed present here. Same questionId handling as
 * submitAudioAnswer — a multipart form field, Number()'d.
 */
async function submitVideoAnswer(req, res, next) {
  try {
    const { questionId } = req.body
    const result = await interviewService.submitVideoAnswer({
      sessionId: Number(req.params.id),
      userId: req.user.userId,
      questionId: Number(questionId),
      videoBuffer: req.file.buffer,
      videoMimeType: req.file.mimetype,
    })
    sendSuccess(res, result, 201)
  } catch (err) {
    next(err)
  }
}

/** What the AI service can currently do (speech model state, camera analysis level) so the UI can warn up front. */
async function getCapabilities(req, res, next) {
  try {
    sendSuccess(res, await require('../services/aiServiceClient').getCapabilities())
  } catch (err) {
    next(err)
  }
}

async function completeInterview(req, res, next) {
  try {
    const session = await interviewService.completeInterviewSession(Number(req.params.id), req.user.userId)
    sendSuccess(res, session)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  createInterview,
  getInterviews,
  getInterview,
  submitAnswer,
  submitAudioAnswer,
  submitVideoAnswer,
  skipQuestion,
  getCapabilities,
  completeInterview,
}
