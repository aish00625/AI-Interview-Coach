const express = require('express')
const adminController = require('../controllers/adminController')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam } = require('../middleware/validators')

const router = express.Router()

// Every admin route: valid JWT, then the role is confirmed against the database.
router.use(requireAuth, requireRole('admin'))

router.get('/overview', adminController.overview)
router.get('/service-health', adminController.serviceHealth)
router.get('/organizations', adminController.listOrganizations)
router.post('/organizations/:id/approve', idParam('id'), handleValidationErrors, adminController.approveOrganization)
router.post('/organizations/:id/reject', idParam('id'), handleValidationErrors, adminController.rejectOrganization)
router.post('/organizations/:id/suspend', idParam('id'), handleValidationErrors, adminController.suspendOrganization)

module.exports = router
