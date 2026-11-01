const express = require('express')
const rateLimit = require('express-rate-limit')
const controller = require('../controllers/accountController')
const { requireAuth } = require('../middleware/auth')
const { handleValidationErrors } = require('../middleware/validate')
const { deleteAccountRules } = require('../middleware/validators')

const router = express.Router()
router.use(requireAuth)

// Deletion re-checks the password, so it is also a password-guessing oracle for a stolen token: keep it tight.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: Number(process.env.ACCOUNT_ACTION_MAX_PER_15MIN) || 10,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
})

router.get('/export', sensitiveLimiter, controller.exportData)
router.delete('/', sensitiveLimiter, deleteAccountRules, handleValidationErrors, controller.remove)

module.exports = router
