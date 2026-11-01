const express = require('express')
const interviewController = require('../controllers/interviewController')
const preparationController = require('../controllers/preparationController')
const localAiController = require('../controllers/localAiController')
const { llmLimiter } = require('../middleware/llmLimiter')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, intParam, followUpRequestRules, followUpAnswerRules, createInterviewRules, submitAnswerRules, submitAudioAnswerRules, submitVideoAnswerRules } = require('../middleware/validators')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { uploadAudio, requireAudioFile } = require('../middleware/audioUpload')
const { uploadVideo, requireVideoFile } = require('../middleware/videoUpload')

const router = express.Router()

// Every interview route is user-specific, so all of them require auth.
// Candidate practice features: the role is confirmed against the database on every request.
router.use(requireAuth, requireRole('candidate'))

router.post('/', createInterviewRules, handleValidationErrors, interviewController.createInterview)
router.get('/', interviewController.getInterviews)
// Must be registered before '/:id' so "capabilities" is not parsed as an interview id.
router.get('/capabilities', interviewController.getCapabilities)
router.get('/:id', [idParam()], handleValidationErrors, interviewController.getInterview)
// Own completed practice interview vs the previous one of the same type and role.
router.get('/:id/comparison', [idParam()], handleValidationErrors, preparationController.getComparison)
router.post('/:id/answer', [idParam(), ...submitAnswerRules], handleValidationErrors, interviewController.submitAnswer)

// idParam is checked first (cheap) before the multipart upload runs;
// uploadAudio.single('audio') is the one consistent field name used by
// the frontend FormData, Node, and onward to the AI service. multer
// populates req.body's other form fields (questionId) as a side effect,
// which is why submitAudioAnswerRules is validated AFTER it, not before.
router.post(
  '/:id/answer/audio',
  [idParam()], handleValidationErrors,
  uploadAudio.single('audio'), requireAudioFile,
  submitAudioAnswerRules, handleValidationErrors,
  interviewController.submitAudioAnswer,
)

// Same structure as the audio route above — one consistent field name
// ("video") used by the frontend FormData, Node, and onward to the AI
// service. Unlike /answer and /answer/audio, this doesn't advance the
// interview itself (see interviewService.submitVideoAnswer) — it attaches
// cv_metrics to an answer that must already exist for this question.
router.post(
  '/:id/answer/video',
  [idParam()], handleValidationErrors,
  uploadVideo.single('video'), requireVideoFile,
  submitVideoAnswerRules, handleValidationErrors,
  interviewController.submitVideoAnswer,
)

// ---- Local-AI features (private practice only; the service refuses hiring assessments). Advisory output, rule-based fallback.
// Multi-turn follow-ups: ask (model or authored fallback), answer (optional short AI feedback, never scored), or skip.
router.post('/:id/follow-ups', [idParam(), ...followUpRequestRules], handleValidationErrors, llmLimiter, localAiController.requestFollowUp)
router.post('/:id/follow-ups/:followUpId/answer', [idParam(), ...followUpAnswerRules], handleValidationErrors, llmLimiter, localAiController.answerFollowUp)
router.post('/:id/follow-ups/:followUpId/skip', [idParam(), intParam('followUpId')], handleValidationErrors, localAiController.skipFollowUp)
// STAR coaching for one answered question; GET returns the saved result, POST (re)generates it.
router.get('/:id/questions/:questionId/star', [idParam(), intParam('questionId')], handleValidationErrors, localAiController.getStar)
router.post('/:id/questions/:questionId/star', [idParam(), intParam('questionId')], handleValidationErrors, llmLimiter, localAiController.generateStar)
// End-of-interview report (completed interviews only).
router.get('/:id/ai-report', [idParam()], handleValidationErrors, localAiController.getReport)
router.post('/:id/ai-report', [idParam()], handleValidationErrors, llmLimiter, localAiController.generateReport)

router.post('/:id/complete', [idParam()], handleValidationErrors, interviewController.completeInterview)

module.exports = router
