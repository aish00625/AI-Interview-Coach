const { sendSuccess } = require('../utils/apiResponse')
const service = require('../services/assessmentAttemptService')

/** Candidate assessment journey (migration 018). Identity is always req.user.userId; every call is scoped to it. */
const wrap = (fn, status = 200) => async (req, res, next) => {
  try { sendSuccess(res, await fn(req), status) } catch (err) { next(err) }
}
const uid = (req) => req.user.userId
const n = (req, name) => Number(req.params[name])

module.exports = {
  list: wrap((req) => service.listMine(uid(req))),
  invitation: wrap((req) => service.getInvitation(uid(req), n(req, 'id'))),
  start: wrap((req) => service.start({
    candidateId: uid(req), invitationId: n(req, 'id'), acceptTerms: req.body.acceptTerms, monitoring: req.body.monitoring, accommodationNote: req.body.accommodationNote,
  })),
  attempt: wrap((req) => service.getAttempt(uid(req), n(req, 'attemptId'))),
  enterSection: wrap((req) => service.enterSection({ candidateId: uid(req), attemptId: n(req, 'attemptId'), sectionId: n(req, 'sectionId') })),
  saveAnswer: wrap((req) => service.saveAnswer({ candidateId: uid(req), attemptId: n(req, 'attemptId'), itemId: n(req, 'itemId'), selectedKeys: req.body.selectedKeys })),
  submitCoding: wrap((req) => service.submitCoding({ candidateId: uid(req), attemptId: n(req, 'attemptId'), itemId: n(req, 'itemId'), language: req.body.language, sourceCode: req.body.sourceCode })),
  startMonitoring: wrap((req) => service.startMonitoring({ candidateId: uid(req), attemptId: n(req, 'attemptId') }), 201),
  monitoringIssue: wrap((req) => service.recordMonitoringIssue({ candidateId: uid(req), attemptId: n(req, 'attemptId'), issue: req.body.issue })),
  submit: wrap((req) => service.submit({ candidateId: uid(req), attemptId: n(req, 'attemptId') })),
  confirmation: wrap((req) => service.confirmation(uid(req), n(req, 'attemptId'))),
}
