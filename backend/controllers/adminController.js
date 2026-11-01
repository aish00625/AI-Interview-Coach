const { sendSuccess, sendError } = require('../utils/apiResponse')
const organizationModel = require('../models/organizationModel')
const adminStats = require('../services/adminStatsService')

const STATUSES = ['pending', 'approved', 'rejected', 'suspended']

async function listOrganizations(req, res, next) {
  try {
    const status = req.query.status && STATUSES.includes(req.query.status) ? req.query.status : null
    const organizations = await organizationModel.listOrganizations({ status })
    sendSuccess(res, { organizations })
  } catch (err) {
    next(err)
  }
}

function reviewAction(status) {
  return async function review(req, res, next) {
    try {
      const org = await organizationModel.setOrganizationStatus({
        id: Number(req.params.id),
        status,
        reviewedBy: req.user.userId,
      })
      if (!org) return sendError(res, 'Organization not found.', 404)
      sendSuccess(res, { organization: org })
    } catch (err) {
      next(err)
    }
  }
}

async function overview(req, res, next) {
  try { sendSuccess(res, await adminStats.getOverview()) } catch (err) { next(err) }
}

async function serviceHealth(req, res, next) {
  try { sendSuccess(res, await adminStats.getServiceHealth()) } catch (err) { next(err) }
}

module.exports = {
  overview,
  serviceHealth,
  listOrganizations,
  approveOrganization: reviewAction('approved'),
  rejectOrganization: reviewAction('rejected'),
  suspendOrganization: reviewAction('suspended'),
}
