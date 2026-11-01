const express = require('express')
const controller = require('../controllers/hirerAssessmentController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization, requireOrgPermission } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, questionRules, questionListQuery } = require('../middleware/validators')

const router = express.Router()

// The question bank contains answer keys, so every route (reads included) needs "manageJobs" (owner/recruiter).
// Reviewers see a question's key and explanation only inside a finished attempt they are assigned to review.
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)

router.get('/', requireOrgPermission('manageJobs'), questionListQuery, handleValidationErrors, controller.questions)
router.post('/', requireOrgPermission('manageJobs'), questionRules, handleValidationErrors, controller.createQuestion)
router.put('/:id', requireOrgPermission('manageJobs'), idParam('id'), questionRules, handleValidationErrors, controller.updateQuestion)
router.post('/:id/archive', requireOrgPermission('manageJobs'), idParam('id'), handleValidationErrors, controller.archiveQuestion)

module.exports = router
