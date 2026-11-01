const multer = require('multer')
const { sendError } = require('../utils/apiResponse')

const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES) || 25 * 1024 * 1024 // 25 MB default — must match ai-service's own MAX_VIDEO_BYTES check

// Mirrors middleware/audioUpload.js's pattern exactly. Matched against the
// file part's declared mimetype with any ";codecs=..." suffix stripped
// first (browsers often send e.g. "video/webm;codecs=vp8,opus").
const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/webm',
  'video/mp4',
  'video/quicktime', // Safari sometimes uses this for recorded clips
  'video/ogg',
])

/**
 * memoryStorage — the file lives only in req.file.buffer for the
 * duration of this request; it is forwarded straight to the AI service
 * and never written to disk on the Node host. (The Python side manages
 * its own temp file for the copy it needs — see
 * ai-service/app/routes/vision.py — and discards it once analysis
 * finishes; the raw video is never persisted anywhere.)
 */
const storage = multer.memoryStorage()

function fileFilter(req, file, cb) {
  const mimeType = (file.mimetype || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_VIDEO_MIME_TYPES.has(mimeType)) {
    // Per multer's documented pattern: a fileFilter rejection via
    // cb(null, false) does NOT raise an error — it just omits req.file.
    // We flag why on the request so requireVideoFile below can report a
    // clean 415 instead of a generic "no file" 400.
    req.fileValidationError = `Unsupported video format: ${file.mimetype}`
    return cb(null, false)
  }
  cb(null, true)
}

const uploadVideo = multer({ storage, limits: { fileSize: MAX_VIDEO_BYTES }, fileFilter })

/** Must run immediately after uploadVideo.single('video') on any route that needs a video file. */
function requireVideoFile(req, res, next) {
  if (req.fileValidationError) return sendError(res, req.fileValidationError, 415)
  if (!req.file) return sendError(res, 'A video file is required.', 400)
  next()
}

module.exports = { uploadVideo, requireVideoFile, MAX_VIDEO_BYTES }
