const express = require('express')
const controller = require('../controllers/hiringTeamController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization, requireOrgPermission } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { auditQuery } = require('../middleware/validators')

const router = express.Router()
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)

// Owners only: who opened which candidate's resume / assessment data, and when.
router.get('/', requireOrgPermission('viewAudit'), auditQuery, handleValidationErrors, controller.auditLog)

module.exports = router
