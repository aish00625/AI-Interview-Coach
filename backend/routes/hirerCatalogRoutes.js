const express = require('express')
const assessmentController = require('../controllers/assessmentController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization } = require('../middleware/roles')

const router = express.Router()

// Lets approved hiring teams pick coding problems for a job assessment. Metadata only; no test cases.
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)
router.get('/', assessmentController.listProblems)

module.exports = router
