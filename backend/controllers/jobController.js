const { sendSuccess } = require('../utils/apiResponse')
const jobService = require('../services/jobService')
const skillInsightService = require('../services/skillInsightService')

/* Hirer side. organizationId always comes from req.organization (set by requireApprovedOrganization). */
const orgId = (req) => req.organization.id

async function create(req, res, next) {
  try {
    const job = await jobService.createJob({ organizationId: orgId(req), userId: req.user.userId, body: req.body })
    sendSuccess(res, { job }, 201)
  } catch (err) { next(err) }
}
async function list(req, res, next) {
  try {
    sendSuccess(res, { jobs: await jobService.listJobs({ organizationId: orgId(req), status: req.query.status }) })
  } catch (err) { next(err) }
}
async function get(req, res, next) {
  try {
    sendSuccess(res, { job: await jobService.getJob({ organizationId: orgId(req), jobId: req.params.id }) })
  } catch (err) { next(err) }
}
async function update(req, res, next) {
  try {
    sendSuccess(res, { job: await jobService.updateJob({ organizationId: orgId(req), jobId: req.params.id, body: req.body }) })
  } catch (err) { next(err) }
}
async function setStatus(req, res, next) {
  try {
    sendSuccess(res, { job: await jobService.changeStatus({ organizationId: orgId(req), jobId: req.params.id, status: req.body.status }) })
  } catch (err) { next(err) }
}
async function remove(req, res, next) {
  try {
    await jobService.deleteJob({ organizationId: orgId(req), jobId: req.params.id })
    sendSuccess(res, { deleted: true })
  } catch (err) { next(err) }
}

/* Candidate side: open jobs only. */
async function listOpen(req, res, next) {
  try {
    const { search, page, limit } = req.query
    sendSuccess(res, { jobs: await jobService.listOpenJobs({ search, page, limit }) })
  } catch (err) { next(err) }
}
async function getOpen(req, res, next) {
  try {
    sendSuccess(res, { job: await jobService.getOpenJob(req.params.id) })
  } catch (err) { next(err) }
}

/** Candidate-only, private: how my profile (and optionally one of my resumes) lines up with this open job. */
async function getFit(req, res, next) {
  try {
    const resumeId = req.query.resumeId ? Number(req.query.resumeId) : null
    sendSuccess(res, await skillInsightService.jobFit({ userId: req.user.userId, jobId: Number(req.params.id), resumeId }))
  } catch (err) { next(err) }
}

module.exports = { create, list, get, update, setStatus, remove, listOpen, getOpen, getFit }
