const { sendError } = require('../utils/apiResponse')
const { verifyToken } = require('../utils/jwt')

/**
 * Real JWT auth middleware (replaces the Phase 3 placeholder, which
 * refused every request).
 *
 * Reads "Authorization: Bearer <token>", verifies it, and attaches the
 * decoded payload to req.user as { userId, email, iat, exp }. Every
 * protected controller uses req.user.userId — never a client-supplied
 * id from the query string or body — so one user can't read or write
 * another user's data by changing an id.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return sendError(res, 'Authentication required.', 401)
  }

  try {
    req.user = verifyToken(token)
    next()
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid authentication token.'
    return sendError(res, message, 401)
  }
}

module.exports = { requireAuth }
