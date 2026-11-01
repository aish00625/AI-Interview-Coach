const multer = require('multer')
const { sendError } = require('../utils/apiResponse')

const MAX_FRAME_BYTES = Number(process.env.FACE_FRAME_MAX_BYTES) || 300 * 1024 // must not exceed the AI service's own limit
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** One webcam frame, held in memory only for the length of the request (never written to disk). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FRAME_BYTES, files: 1, fields: 5 },
  fileFilter(req, file, cb) {
    const type = (file.mimetype || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED.has(type)) { req.fileValidationError = 'Frames must be JPEG, PNG or WebP images.'; return cb(null, false) }
    cb(null, true)
  },
})

/** Signature check, so a file merely labelled image/jpeg is not forwarded as one. */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

const uploadFaceFrame = {
  single(field) {
    const mw = upload.single(field)
    return (req, res, next) => mw(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') { err.code = 'FRAME_TOO_LARGE'; err.statusCode = 413 }
      next(err)
    })
  },
}

function requireFaceFrame(req, res, next) {
  if (req.fileValidationError) return sendError(res, req.fileValidationError, 415)
  if (!req.file) return sendError(res, 'A camera frame is required (field name "frame").', 400)
  const kind = sniffImage(req.file.buffer)
  if (!kind) return sendError(res, 'The upload is not a JPEG, PNG or WebP image.', 415)
  req.file.mimetype = kind
  next()
}

module.exports = { uploadFaceFrame, requireFaceFrame, sniffImage, MAX_FRAME_BYTES }
