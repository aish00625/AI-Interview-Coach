const { sendError } = require('../utils/apiResponse')

/**
 * Common PostgreSQL error codes (see
 * https://www.postgresql.org/docs/current/errcodes-appendix.html) mapped
 * to a clean HTTP status + message. Anything not in this table falls
 * through to the generic 500 handling below.
 */
const PG_ERROR_MAP = {
  '23505': { statusCode: 409, message: 'A record with that value already exists.' }, // unique_violation
  '23503': { statusCode: 409, message: 'This action references a record that does not exist.' }, // foreign_key_violation
  '23502': { statusCode: 400, message: 'A required field is missing.' }, // not_null_violation
  '22003': { statusCode: 400, message: 'A numeric value is out of range.' }, // numeric_value_out_of_range (e.g. an absurdly large id)
  '22P02': { statusCode: 400, message: 'One of the provided values has an invalid format.' }, // invalid_text_representation
  '23514': { statusCode: 400, message: 'A provided value is not one of the allowed options.' }, // check_violation
  ECONNREFUSED: { statusCode: 503, message: 'Database is currently unavailable.' },
}

/**
 * multer (see middleware/audioUpload.js) raises these via next(err)
 * automatically for limit violations — unlike a fileFilter rejection
 * (cb(null, false)), which doesn't error at all, see requireAudioFile.
 */
const MULTER_ERROR_MAP = {
  LIMIT_FILE_SIZE: { statusCode: 413, message: 'Audio file is too large.' },
  FRAME_TOO_LARGE: { statusCode: 413, message: 'The camera frame is too large.' },
}

/**
 * Centralized error handler — must be the LAST middleware registered in
 * app.js, and must keep all four arguments (Express uses the arg count to
 * recognize an error handler, even though `next` is unused here).
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err)

  const pgMatch = PG_ERROR_MAP[err.code]
  const multerMatch = MULTER_ERROR_MAP[err.code]
  const knownMatch = pgMatch || multerMatch
  const statusCode = knownMatch?.statusCode || err.statusCode || 500

  let message
  if (process.env.NODE_ENV === 'production') {
    // Never leak raw PostgreSQL error text or stack traces in production —
    // only ever the mapped message, or a generic fallback.
    message = knownMatch?.message || 'Something went wrong'
  } else {
    // In development, prefer the mapped message but fall back to the real
    // error text so it's actually debuggable.
    message = knownMatch?.message || err.message || 'Something went wrong'
  }

  // AI-service errors carry a stable machine-readable reason (see services/aiServiceClient.js); other errors do not.
  const extra = !knownMatch && typeof err.reason === 'string' ? { reason: err.reason, retryable: err.retryable } : null
  sendError(res, message, statusCode, extra)
}

module.exports = errorHandler
