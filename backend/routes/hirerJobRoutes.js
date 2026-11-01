const express = require('express')
const jobController = require('../controllers/jobController')
const assessmentController = require('../controllers/assessmentController')
const applicationController = require('../controllers/hirerApplicationController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization, requireOrgPermission } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, createJobRules, updateJobRules, jobStatusRules, jobListQuery, assessmentConfigRules, applicantListQuery, compareQuery } = require('../middleware/validators')

const router = express.Router()

// Hirer + approved organization on every route; all queries are scoped to req.organization.id.
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)

router.get('/', requireOrgPermission('view'), jobListQuery, handleValidationErrors, jobController.list)
router.post('/', requireOrgPermission('manageJobs'), createJobRules, handleValidationErrors, jobController.create)
router.get('/:id', requireOrgPermission('view'), idParam('id'), handleValidationErrors, jobController.get)
router.patch('/:id', requireOrgPermission('manageJobs'), idParam('id'), updateJobRules, handleValidationErrors, jobController.update)
router.post('/:id/status', requireOrgPermission('manageJobs'), idParam('id'), jobStatusRules, handleValidationErrors, jobController.setStatus)
router.get('/:id/assessment', requireOrgPermission('view'), idParam('id'), handleValidationErrors, assessmentController.getConfig)
router.put('/:id/assessment', requireOrgPermission('manageJobs'), idParam('id'), assessmentConfigRules, handleValidationErrors, assessmentController.setConfig)
router.get('/:id/applications', requireOrgPermission('view'), idParam('id'), applicantListQuery, handleValidationErrors, applicationController.listApplicants)
router.get('/:id/compare', requireOrgPermission('view'), idParam('id'), compareQuery, handleValidationErrors, applicationController.compare)
router.delete('/:id', requireOrgPermission('manageJobs'), idParam('id'), handleValidationErrors, jobController.remove)

module.exports = router
