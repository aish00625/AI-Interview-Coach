/**
 * Two tiny helpers so every controller returns the exact same JSON shape,
 * instead of each one inventing its own success/error format.
 *
 *   success:  { success: true,  data: {...} }
 *   error:    { success: false, message: "..." }
 */

function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data })
}

function sendError(res, message = 'Something went wrong', statusCode = 500, extra = null) {
  // `extra` ({ reason, retryable }) is additive: existing clients that only read `message` are unaffected.
  const body = { success: false, message }
  if (extra && typeof extra.reason === 'string') body.reason = extra.reason
  if (extra && typeof extra.retryable === 'boolean') body.retryable = extra.retryable
  return res.status(statusCode).json(body)
}

/** Shorthand for a route/feature that exists but isn't built yet. */
function notImplemented(res, message = 'Endpoint not implemented yet') {
  return sendError(res, message, 501)
}

module.exports = { sendSuccess, sendError, notImplemented }
