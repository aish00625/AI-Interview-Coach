const { validationResult } = require('express-validator')
const { sendError } = require('../utils/apiResponse')

/**
 * Reusable validation-result handler for express-validator.
 *
 * Usage in a route file (added as real validation rules land in later
 * phases):
 *
 *   const { body } = require('express-validator')
 *   router.post(
 *     '/register',
 *     [body('email').isEmail(), body('password').isLength({ min: 8 })],
 *     handleValidationErrors,
 *     authController.register,
 *   )
 *
 * No routes pass real validator arrays yet in Phase 3 — this middleware is
 * just ready for Phase 5+ to use.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return sendError(res, errors.array()[0].msg, 400)
  }
  next()
}

module.exports = { handleValidationErrors }
