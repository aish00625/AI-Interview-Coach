const multer = require('multer')
const { sendError } = require('../utils/apiResponse')

const MAX_RESUME_BYTES = Number(process.env.MAX_RESUME_BYTES) || 5 * 1024 * 1024 // 5 MB

// memoryStorage: the buffer is validated by content (utils/resumeFile) before anything touches disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESUME_BYTES, files: 1, fields: 5 } })
const single = upload.single('resume')

/** Wraps multer so its errors become clean resume-specific responses (the global handler's wording is audio-specific). */
function uploadResume(req, res, next) {
  single(req, res, (err) => {
    if (!err) {
      if (!req.file) return sendError(res, 'A resume file is required (field name "resume").', 400)
      return next()
    }
    if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, `Resume is too large (max ${Math.round(MAX_RESUME_BYTES / 1024 / 1024)} MB).`, 413)
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return sendError(res, 'Upload exactly one file in the "resume" field.', 400)
    if (err.name === 'MulterError') return sendError(res, 'Invalid upload.', 400)
    next(err)
  })
}

module.exports = { uploadResume, MAX_RESUME_BYTES }
