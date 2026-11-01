const jwt = require('jsonwebtoken')

/**
 * Thin wrapper around jsonwebtoken so the secret/expiry env vars and the
 * token payload shape live in exactly one place.
 *
 * The payload deliberately contains only { userId, email, role } — no password
 * hash, no profile data. Never put anything in here you wouldn't be fine
 * with a client decoding and reading (JWTs are signed, not encrypted).
 */

function generateToken({ userId, email, role }) {
  // `role` is a UI hint only. Authorization never trusts it: requireRole()
  // re-reads the role from the database on every guarded request.
  return jwt.sign({ userId, email, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

/** Throws (jwt.verify's own errors: TokenExpiredError / JsonWebTokenError) on an invalid/expired token — callers handle that. */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}

module.exports = { generateToken, verifyToken }
