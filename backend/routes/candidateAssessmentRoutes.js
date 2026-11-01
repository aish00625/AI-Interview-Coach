const express = require('express')
const rateLimit = require('express-rate-limit')
const controller = require('../controllers/candidateAssessmentController')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, startAttemptRules, saveAnswerRules, assessmentCodeRules, monitoringIssueRules } = require('../middleware/validators')

const router = express.Router()

// Candidate's own invitations and attempts only (every service call is scoped to req.user.userId). Monitoring frames use the
// existing /api/face-monitoring session routes, which are also candidate-only and owner-scoped.
router.use(requireAuth, requireRole('candidate'))

// Each coding submission starts a Docker container: rate limited per user, like Run Code.
const codeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RUN_CODE_MAX_PER_MINUTE) || 20,
  keyGenerator: (req) => `assessment-code:${req.user?.userId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You are submitting code too quickly. Please wait a moment and try again.' },
})

router.get('/', controller.list)
router.get('/invitations/:id', idParam('id'), handleValidationErrors, controller.invitation)
router.post('/invitations/:id/start', idParam('id'), startAttemptRules, handleValidationErrors, controller.start)
router.get('/attempts/:attemptId', idParam('attemptId'), handleValidationErrors, controller.attempt)
router.post('/attempts/:attemptId/sections/:sectionId/enter', idParam('attemptId'), idParam('sectionId'), handleValidationErrors, controller.enterSection)
router.put('/attempts/:attemptId/answers/:itemId', idParam('attemptId'), idParam('itemId'), saveAnswerRules, handleValidationErrors, controller.saveAnswer)
router.post('/attempts/:attemptId/coding/:itemId', codeLimiter, idParam('attemptId'), idParam('itemId'), assessmentCodeRules, handleValidationErrors, controller.submitCoding)
router.post('/attempts/:attemptId/monitoring', idParam('attemptId'), handleValidationErrors, controller.startMonitoring)
router.post('/attempts/:attemptId/monitoring-issues', idParam('attemptId'), monitoringIssueRules, handleValidationErrors, controller.monitoringIssue)
router.post('/attempts/:attemptId/submit', idParam('attemptId'), handleValidationErrors, controller.submit)
router.get('/attempts/:attemptId/confirmation', idParam('attemptId'), handleValidationErrors, controller.confirmation)

module.exports = router
