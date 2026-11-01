const { sendSuccess } = require('../utils/apiResponse')
const resumeService = require('../services/resumeService')
const skillInsightService = require('../services/skillInsightService')
const { attachment } = require('../utils/contentDisposition')

async function upload(req, res, next) {
  try {
    sendSuccess(res, { resume: await resumeService.uploadResume({ userId: req.user.userId, file: req.file }) }, 201)
  } catch (err) { next(err) }
}
async function list(req, res, next) {
  try { sendSuccess(res, { resumes: await resumeService.listResumes(req.user.userId) }) } catch (err) { next(err) }
}
async function get(req, res, next) {
  try { sendSuccess(res, { resume: await resumeService.getResume({ userId: req.user.userId, resumeId: req.params.id }) }) } catch (err) { next(err) }
}
async function remove(req, res, next) {
  try {
    await resumeService.deleteResume({ userId: req.user.userId, resumeId: req.params.id })
    sendSuccess(res, { deleted: true })
  } catch (err) { next(err) }
}

/** Streams a file to the client. Shared with the hirer download endpoint (which authorizes first). */
function pipeFile(res, next, file) {
  res.setHeader('Content-Type', file.contentType)
  res.setHeader('Content-Disposition', attachment(file.filename))
  res.setHeader('Content-Length', String(file.size))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  file.stream.on('error', next)
  file.stream.pipe(res)
}

async function download(req, res, next) {
  try {
    pipeFile(res, next, await resumeService.downloadOwnResume({ userId: req.user.userId, resumeId: req.params.id }))
  } catch (err) { next(err) }
}

/** Skills found in the caller's own resume text, as suggestions to review; nothing is saved. */
async function suggestSkills(req, res, next) {
  try {
    sendSuccess(res, await skillInsightService.suggestFromResume({ userId: req.user.userId, resumeId: req.params.id }))
  } catch (err) { next(err) }
}

module.exports = { upload, list, get, remove, download, suggestSkills, pipeFile }
