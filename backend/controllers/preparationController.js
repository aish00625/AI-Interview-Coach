const { sendSuccess } = require('../utils/apiResponse')
const service = require('../services/preparationService')

async function getPreparation(req, res, next) {
  try { sendSuccess(res, await service.getPreparation(req.user.userId)) } catch (err) { next(err) }
}

async function putGoals(req, res, next) {
  try {
    const goals = await service.setGoals(req.user.userId, { weeklyInterviews: req.body.weeklyInterviews, weeklyProblems: req.body.weeklyProblems })
    sendSuccess(res, { goals })
  } catch (err) { next(err) }
}

async function getComparison(req, res, next) {
  try { sendSuccess(res, await service.getInterviewComparison(req.user.userId, Number(req.params.id))) } catch (err) { next(err) }
}

module.exports = { getPreparation, putGoals, getComparison }
