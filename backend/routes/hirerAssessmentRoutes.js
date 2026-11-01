const express = require('express')
const controller = require('../controllers/hirerAssessmentController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization, requireOrgPermission } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const {
  idParam, applicationNoteRules, assessmentDefinitionRules, assessmentReviewersRules, assessmentInviteRules, assessmentReviewStatusRules,
} = require('../middleware/validators')

const router = express.Router()

// Hirer + approved organization on every route; queries are scoped to req.organization.id, and reviewers additionally see
// only the assessments they are assigned to (enforced in the service). Building and inviting need "manageJobs"
// (owner/recruiter); reading needs "view"; review notes and review status need "review".
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)

router.get('/', requireOrgPermission('view'), controller.list)
router.post('/', requireOrgPermission('manageJobs'), assessmentDefinitionRules, handleValidationErrors, controller.create)

// Attempt results (declared before '/:id' so "attempts" is never read as an assessment id).
router.get('/attempts/:attemptId', requireOrgPermission('view'), idParam('attemptId'), handleValidationErrors, controller.attempt)
router.post('/attempts/:attemptId/notes', requireOrgPermission('review'), idParam('attemptId'), applicationNoteRules, handleValidationErrors, controller.addNote)
router.patch('/attempts/:attemptId/review-status', requireOrgPermission('review'), idParam('attemptId'), assessmentReviewStatusRules, handleValidationErrors, controller.setReviewStatus)

router.get('/:id', requireOrgPermission('view'), idParam('id'), handleValidationErrors, controller.get)
router.put('/:id', requireOrgPermission('manageJobs'), idParam('id'), assessmentDefinitionRules, handleValidationErrors, controller.update)
router.post('/:id/publish', requireOrgPermission('manageJobs'), idParam('id'), handleValidationErrors, controller.publish)
router.post('/:id/close', requireOrgPermission('manageJobs'), idParam('id'), handleValidationErrors, controller.close)
router.post('/:id/versions', requireOrgPermission('manageJobs'), idParam('id'), handleValidationErrors, controller.newVersion)
router.get('/:id/preview', requireOrgPermission('view'), idParam('id'), handleValidationErrors, controller.preview)
router.put('/:id/reviewers', requireOrgPermission('manageJobs'), idParam('id'), assessmentReviewersRules, handleValidationErrors, controller.setReviewers)
router.get('/:id/candidates', requireOrgPermission('view'), idParam('id'), handleValidationErrors, controller.candidates)
router.post('/:id/invitations', requireOrgPermission('manageJobs'), idParam('id'), assessmentInviteRules, handleValidationErrors, controller.invite)
router.delete('/:id/invitations/:invitationId', requireOrgPermission('manageJobs'), idParam('id'), idParam('invitationId'), handleValidationErrors, controller.revokeInvitation)
router.get('/:id/attempts', requireOrgPermission('view'), idParam('id'), handleValidationErrors, controller.attempts)

module.exports = router
