const { sendSuccess } = require('../utils/apiResponse')
const svc = require('../services/faceMonitorService')

/** Thin controllers: identity always comes from the verified JWT (req.user.userId); ids from the URL are only lookups. */
const uid = (req) => req.user.userId
const sid = (req) => Number(req.params.id)
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (err) { next(err) } }

module.exports = {
  getCapabilities: wrap(async (req, res) => sendSuccess(res, await svc.getCapabilities())),
  listSessions: wrap(async (req, res) => sendSuccess(res, await svc.listSessions({ userId: uid(req) }))),
  createSession: wrap(async (req, res) => {
    const { consent, identityConsent, interviewSessionId } = req.body
    sendSuccess(res, await svc.createSession({ userId: uid(req), consent: consent === true, identityConsent: identityConsent === true, interviewSessionId: interviewSessionId == null ? null : Number(interviewSessionId) }), 201)
  }),
  getSession: wrap(async (req, res) => sendSuccess(res, await svc.getSession({ userId: uid(req), sessionId: sid(req) }))),
  submitFrame: wrap(async (req, res) => sendSuccess(res, await svc.submitFrame({ userId: uid(req), sessionId: sid(req), frameBuffer: req.file.buffer, mimeType: req.file.mimetype }))),
  captureReference: wrap(async (req, res) => sendSuccess(res, await svc.captureReference({ userId: uid(req), sessionId: sid(req), frameBuffer: req.file.buffer, mimeType: req.file.mimetype }))),
  cameraStatus: wrap(async (req, res) => sendSuccess(res, await svc.reportCameraStatus({ userId: uid(req), sessionId: sid(req), status: req.body.status }))),
  pause: wrap(async (req, res) => sendSuccess(res, await svc.pauseSession({ userId: uid(req), sessionId: sid(req) }))),
  resume: wrap(async (req, res) => sendSuccess(res, await svc.resumeSession({ userId: uid(req), sessionId: sid(req) }))),
  end: wrap(async (req, res) => sendSuccess(res, await svc.endSession({ userId: uid(req), sessionId: sid(req) }))),
  getReport: wrap(async (req, res) => sendSuccess(res, await svc.getReport({ userId: uid(req), sessionId: sid(req) }))),
  remove: wrap(async (req, res) => sendSuccess(res, await svc.deleteSession({ userId: uid(req), sessionId: sid(req) }))),
}
