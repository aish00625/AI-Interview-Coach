const express = require('express')
const codingController = require('../controllers/codingController')
const localAiController = require('../controllers/localAiController')
const { llmLimiter } = require('../middleware/llmLimiter')
const { handleValidationErrors } = require('../middleware/validate')
const rateLimit = require('express-rate-limit')
const { idParam, difficultyQuery, topicQuery, searchQuery, createSubmissionRules, runCodeRules } = require('../middleware/validators')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')

const router = express.Router()

// Problem browsing isn't user-specific — no auth required.
router.get('/problems', [difficultyQuery, topicQuery, searchQuery], handleValidationErrors, codingController.getCodingProblems)
router.get('/problems/:id', [idParam()], handleValidationErrors, codingController.getCodingProblem)

// Everything below is tied to "the current user" — requires auth.

// Phase 8: persist a submission (status "pending"), no execution.
router.post('/submissions', requireAuth, requireRole('candidate'), createSubmissionRules, handleValidationErrors, codingController.createSubmission)
router.get('/submissions', requireAuth, requireRole('candidate'), codingController.getMySubmissions)
// Lightweight solved/attempted flags per problem for the problem list (no code, no tests).
router.get('/progress', requireAuth, requireRole('candidate'), codingController.getMyProgress)
router.get('/submissions/:id', requireAuth, requireRole('candidate'), [idParam()], handleValidationErrors, codingController.getSubmission)

// Phase I: Run Code. Each run starts a Docker container, so it is rate limited per user (not per IP).
const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RUN_CODE_MAX_PER_MINUTE) || 20,
  keyGenerator: (req) => `run:${req.user?.userId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You are running code too quickly. Please wait a moment and try again.' },
})
router.post('/run', requireAuth, requireRole('candidate'), runLimiter, runCodeRules, handleValidationErrors, codingController.runCode)

// Coding coach: runs the VISIBLE sample tests in Docker, then adds advisory AI explanation (rate limited: container + model).
router.post('/coach', requireAuth, requireRole('candidate'), runLimiter, llmLimiter, runCodeRules, handleValidationErrors, localAiController.coachCode)

// Tiered hints: revealed one level at a time; withheld for problems in an active job assessment.
router.get('/problems/:id/hints', requireAuth, requireRole('candidate'), [idParam()], handleValidationErrors, codingController.getHints)
router.post('/problems/:id/hints/next', requireAuth, requireRole('candidate'), [idParam()], handleValidationErrors, codingController.revealNextHint)

// Reserved placeholder: use POST /submissions (it executes and records).
router.post('/submit', requireAuth, requireRole('candidate'), codingController.submitCode)

module.exports = router
