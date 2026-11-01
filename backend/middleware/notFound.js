const { sendError } = require('../utils/apiResponse')

/** Catches any request that didn't match a real route. Mounted last, after all routes. */
function notFound(req, res) {
  sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404)
}

module.exports = notFound
