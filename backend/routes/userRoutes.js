const express = require('express')
const userController = require('../controllers/userController')
const { handleValidationErrors } = require('../middleware/validate')
const { profileUpdateRules } = require('../middleware/validators')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')

const router = express.Router()

router.get('/profile', requireAuth, requireRole('candidate'), userController.getProfile)
router.put('/profile', requireAuth, requireRole('candidate'), profileUpdateRules, handleValidationErrors, userController.updateProfile)

module.exports = router
