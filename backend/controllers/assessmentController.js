const { sendSuccess } = require('../utils/apiResponse')
const assessmentService = require('../services/assessmentService')
const codingModel = require('../models/codingModel')

/* Hirer: assessment configuration for one of their organization's jobs. */
async function getConfig(req, res, next) {
  try {
    sendSuccess(res, { assessment: await assessmentService.getJobAssessment({ organizationId: req.organization.id, jobId: req.params.id }) })
  } catch (err) { next(err) }
}
async function setConfig(req, res, next) {
  try {
    const { interviewEnabled, interviewType, interviewDifficulty, problemIds } = req.body
    sendSuccess(res, {
      assessment: await assessmentService.setJobAssessment({
        organizationId: req.organization.id, jobId: req.params.id, interviewEnabled, interviewType, interviewDifficulty, problemIds,
      }),
    })
  } catch (err) { next(err) }
}

/** Problem catalogue for the picker: id/title/difficulty/topic only (never test cases — getAllProblems does not select them). */
async function listProblems(req, res, next) {
  try {
    const problems = await codingModel.getAllProblems({})
    sendSuccess(res, { problems: problems.map((p) => ({ id: p.id, title: p.title, difficulty: p.difficulty, topic: p.topic })) })
  } catch (err) { next(err) }
}

/* Candidate: start the interview assessment of one of their own applications. */
async function startInterview(req, res, next) {
  try {
    const { session, questions, resumed } = await assessmentService.startInterviewAssessment({
      candidateId: req.user.userId, applicationId: req.params.id,
    })
    sendSuccess(res, { session, questions, resumed }, resumed ? 200 : 201)
  } catch (err) { next(err) }
}

module.exports = { getConfig, setConfig, listProblems, startInterview }
