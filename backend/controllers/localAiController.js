const { sendSuccess } = require('../utils/apiResponse')
const localAi = require('../services/localAiService')

/** Thin controllers: identity always comes from the verified JWT (req.user.userId); ids from the URL are only lookups. */
const uid = (req) => req.user.userId
const num = (v) => Number(v)
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res) } catch (err) { next(err) } }

module.exports = {
  getAiStatus: wrap(async (req, res) => sendSuccess(res, await localAi.getStatus())),
  getDailyPlan: wrap(async (req, res) => sendSuccess(res, await localAi.getDailyPlan(uid(req)))),

  requestFollowUp: wrap(async (req, res) => {
    const out = await localAi.requestFollowUp({ userId: uid(req), sessionId: num(req.params.id), questionId: num(req.body.questionId) })
    sendSuccess(res, out, out.created ? 201 : 200)
  }),
  answerFollowUp: wrap(async (req, res) => sendSuccess(res, await localAi.answerFollowUp({ userId: uid(req), sessionId: num(req.params.id), followUpId: num(req.params.followUpId), answerText: req.body.answerText }))),
  skipFollowUp: wrap(async (req, res) => sendSuccess(res, await localAi.skipFollowUp({ userId: uid(req), sessionId: num(req.params.id), followUpId: num(req.params.followUpId) }))),

  getStar: wrap(async (req, res) => sendSuccess(res, await localAi.getSavedStar({ userId: uid(req), sessionId: num(req.params.id), questionId: num(req.params.questionId) }))),
  generateStar: wrap(async (req, res) => sendSuccess(res, await localAi.generateStar({ userId: uid(req), sessionId: num(req.params.id), questionId: num(req.params.questionId) }))),

  getReport: wrap(async (req, res) => sendSuccess(res, await localAi.getSavedReport({ userId: uid(req), sessionId: num(req.params.id) }))),
  generateReport: wrap(async (req, res) => sendSuccess(res, await localAi.generateReport({ userId: uid(req), sessionId: num(req.params.id) }))),

  coachCode: wrap(async (req, res) => {
    const { problemId, language, sourceCode } = req.body
    sendSuccess(res, await localAi.coachCode({ userId: uid(req), problemId: num(problemId), language, sourceCode }))
  }),
}
