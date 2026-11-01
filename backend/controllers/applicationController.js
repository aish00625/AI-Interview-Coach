const { sendSuccess } = require('../utils/apiResponse')
const applicationService = require('../services/applicationService')

async function apply(req, res, next) {
  try {
    const application = await applicationService.apply({
      candidateId: req.user.userId, jobId: req.body.jobId, resumeId: req.body.resumeId, coverNote: req.body.coverNote,
      consentShareResume: req.body.consentShareResume === true || req.body.consentShareResume === 'true',
      consentShareAssessment: req.body.consentShareAssessment === true || req.body.consentShareAssessment === 'true',
    })
    sendSuccess(res, { application }, 201)
  } catch (err) { next(err) }
}
async function list(req, res, next) {
  try { sendSuccess(res, { applications: await applicationService.listMine(req.user.userId) }) } catch (err) { next(err) }
}
async function get(req, res, next) {
  try { sendSuccess(res, { application: await applicationService.getMine({ candidateId: req.user.userId, applicationId: req.params.id }) }) } catch (err) { next(err) }
}
async function withdraw(req, res, next) {
  try { sendSuccess(res, { application: await applicationService.withdraw({ candidateId: req.user.userId, applicationId: req.params.id }) }) } catch (err) { next(err) }
}
async function consent(req, res, next) {
  try {
    const b = req.body
    sendSuccess(res, { application: await applicationService.recordConsent({ candidateId: req.user.userId, applicationId: req.params.id, resume: b.resume === true || b.resume === 'true', assessment: b.assessment === true || b.assessment === 'true' }) })
  } catch (err) { next(err) }
}
async function accessLog(req, res, next) {
  try { sendSuccess(res, { entries: await applicationService.accessLog({ candidateId: req.user.userId, applicationId: req.params.id }) }) } catch (err) { next(err) }
}
module.exports = { apply, list, get, withdraw, consent, accessLog }
