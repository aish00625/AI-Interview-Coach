const express = require('express')
const rateLimit = require('express-rate-limit')
const authController = require('../controllers/authController')
const { handleValidationErrors } = require('../middleware/validate')
const { registerRules, loginRules } = require('../middleware/validators')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Brute-force protection, layered on top of the general /api limiter in app.js.
// Failed logins only: successful sign-ins do not count against the budget.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_MAX_ATTEMPTS) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.' },
})
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTER_MAX_PER_HOUR) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many sign-ups from this address. Please try again later.' },
})

router.post('/register', registerLimiter, registerRules, handleValidationErrors, authController.register)
router.post('/login', loginLimiter, loginRules, handleValidationErrors, authController.login)
router.get('/me', requireAuth, authController.me)
router.post('/logout', requireAuth, authController.logout)

module.exports = router
