const express = require('express')
const controller = require('../controllers/hirerApplicationController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization, requireOrgPermission } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, applicationStatusRules, applicationNoteRules, scorecardRules } = require('../middleware/validators')

const router = express.Router()

// Hirer + APPROVED organization; every query is additionally scoped to req.organization.id in SQL.
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)

// The member role (owner / recruiter / reviewer) then decides what each route allows (utils/orgPermissions.js).
router.get('/dashboard', requireOrgPermission('view'), controller.dashboard)
router.get('/applications/:id', requireOrgPermission('view'), idParam('id'), handleValidationErrors, controller.getReview)
router.post('/applications/:id/status', requireOrgPermission('decide'), idParam('id'), applicationStatusRules, handleValidationErrors, controller.changeStatus)
router.post('/applications/:id/notes', requireOrgPermission('review'), idParam('id'), applicationNoteRules, handleValidationErrors, controller.addNote)
router.post('/applications/:id/scorecard', requireOrgPermission('review'), idParam('id'), scorecardRules, handleValidationErrors, controller.submitScorecard)
router.get('/applications/:id/resume', requireOrgPermission('view'), idParam('id'), handleValidationErrors, controller.downloadResume)

module.exports = router
