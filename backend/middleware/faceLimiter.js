const rateLimit = require('express-rate-limit')

const perUser = (prefix, max, message) => rateLimit({
  windowMs: 60 * 1000,
  max,
  keyGenerator: (req) => `${prefix}:${req.user?.userId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message },
})

/** One frame every ~2 s is expected; this leaves room for retries but stops a script from flooding the CPU-bound AI service. */
const faceFrameLimiter = perUser('face-frame', Number(process.env.FACE_FRAME_MAX_PER_MINUTE) || 60, 'Camera frames are being sent too quickly. Please slow down.')
const faceReferenceLimiter = perUser('face-ref', Number(process.env.FACE_REFERENCE_MAX_PER_MINUTE) || 10, 'Too many reference photos. Please wait a moment.')

module.exports = { faceFrameLimiter, faceReferenceLimiter }
