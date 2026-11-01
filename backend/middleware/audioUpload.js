const multer = require('multer')
const { sendError } = require('../utils/apiResponse')

const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES) || 10 * 1024 * 1024 // 10 MB default

// Browsers' MediaRecorder commonly produces "audio/webm" (Chrome/Firefox)
// or "audio/mp4" (Safari); accept the other common container types too.
// Matched against the file part's declared mimetype with any
// ";codecs=..." suffix stripped first (browsers often send e.g.
// "audio/webm;codecs=opus").
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm', 'video/webm', // some browsers label a webm/opus audio-only blob this way
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/ogg',
])

/**
 * memoryStorage — the file lives only in req.file.buffer for the
 * duration of this request; it is forwarded straight to the AI service
 * and never written to disk on the Node host, so there's nothing here to
 * clean up on this side. (The Python side manages its own temp file for
 * the audio it receives — see ai-service/app/routes/speech.py.)
 */
const storage = multer.memoryStorage()

function fileFilter(req, file, cb) {
  const mimeType = (file.mimetype || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
    // Per multer's documented pattern: a fileFilter rejection via
    // cb(null, false) does NOT raise an error — it just omits req.file.
    // We flag why on the request so requireAudioFile below can report a
    // clean 415 instead of a generic "no file" 400.
    req.fileValidationError = `Unsupported audio format: ${file.mimetype}`
    return cb(null, false)
  }
  cb(null, true)
}

const uploadAudio = multer({ storage, limits: { fileSize: MAX_AUDIO_BYTES }, fileFilter })

/** Must run immediately after uploadAudio.single('audio') on any route that needs an audio file. */
function requireAudioFile(req, res, next) {
  if (req.fileValidationError) return sendError(res, req.fileValidationError, 415)
  if (!req.file) return sendError(res, 'An audio file is required.', 400)
  next()
}

module.exports = { uploadAudio, requireAudioFile, MAX_AUDIO_BYTES }
