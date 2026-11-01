const express = require('express')
const applicationController = require('../controllers/applicationController')
const assessmentController = require('../controllers/assessmentController')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, applyRules, consentRules } = require('../middleware/validators')

const router = express.Router()

// Candidate's own applications only (scoped by candidate_id in SQL).
router.use(requireAuth, requireRole('candidate'))

router.get('/', applicationController.list)
router.post('/', applyRules, handleValidationErrors, applicationController.apply)
router.get('/:id', idParam('id'), handleValidationErrors, applicationController.get)
router.post('/:id/consent', idParam('id'), consentRules, handleValidationErrors, applicationController.consent)
router.get('/:id/access-log', idParam('id'), handleValidationErrors, applicationController.accessLog)
router.post('/:id/withdraw', idParam('id'), handleValidationErrors, applicationController.withdraw)
router.post('/:id/assessment/interview', idParam('id'), handleValidationErrors, assessmentController.startInterview)

module.exports = router
