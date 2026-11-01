const { sendSuccess } = require('../utils/apiResponse')
const service = require('../services/hirerApplicationService')
const { pipeFile } = require('./resumeController')

const org = (req) => req.organization.id

async function listApplicants(req, res, next) {
  try {
    const { status, search, sort } = req.query
    sendSuccess(res, await service.listApplicants({ organizationId: org(req), jobId: req.params.id, status, search, sort }))
  } catch (err) { next(err) }
}
async function compare(req, res, next) {
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean)
    sendSuccess(res, await service.compare({ organizationId: org(req), jobId: req.params.id, ids, actorId: req.user.userId }))
  } catch (err) { next(err) }
}
async function getReview(req, res, next) {
  try { sendSuccess(res, await service.getReview({ organizationId: org(req), applicationId: req.params.id, actorId: req.user.userId, actorRole: req.organization.member_role })) } catch (err) { next(err) }
}
async function changeStatus(req, res, next) {
  try {
    sendSuccess(res, await service.changeStatus({
      organizationId: org(req), applicationId: req.params.id, userId: req.user.userId, actorRole: req.organization.member_role, status: req.body.status, note: req.body.note, reasonCode: req.body.reasonCode,
    }))
  } catch (err) { next(err) }
}
async function submitScorecard(req, res, next) {
  try {
    const { recommendation, summary, ratings } = req.body
    sendSuccess(res, { scorecards: await service.submitScorecard({ organizationId: org(req), applicationId: req.params.id, userId: req.user.userId, recommendation, summary, ratings }) })
  } catch (err) { next(err) }
}
async function addNote(req, res, next) {
  try {
    sendSuccess(res, { notes: await service.addNote({ organizationId: org(req), applicationId: req.params.id, userId: req.user.userId, body: req.body.body }) }, 201)
  } catch (err) { next(err) }
}
async function downloadResume(req, res, next) {
  try { pipeFile(res, next, await service.openResume({ organizationId: org(req), applicationId: req.params.id, actorId: req.user.userId })) } catch (err) { next(err) }
}
async function dashboard(req, res, next) {
  try { sendSuccess(res, await service.getDashboard({ organizationId: org(req) })) } catch (err) { next(err) }
}

module.exports = { listApplicants, compare, getReview, changeStatus, submitScorecard, addNote, downloadResume, dashboard }
