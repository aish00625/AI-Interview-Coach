const { sendSuccess } = require('../utils/apiResponse')
const builder = require('../services/assessmentBuilderService')
const results = require('../services/assessmentResultsService')
const questionBank = require('../services/questionBankService')

/**
 * Hirer assessment builder, results and question bank (migration 018). Thin: the organization and member role come from
 * requireApprovedOrganization (database), the user from the verified token. Nothing scoping-related is read from the body.
 */
const ctx = (req) => ({ organization: req.organization, userId: req.user.userId })
const wrap = (fn, status = 200) => async (req, res, next) => {
  try { sendSuccess(res, await fn(req), status) } catch (err) { next(err) }
}
const id = (req, name = 'id') => Number(req.params[name])

module.exports = {
  list: wrap((req) => builder.list(req.organization, req.user.userId)),
  create: wrap((req) => builder.create({ ...ctx(req), input: req.body }), 201),
  get: wrap((req) => builder.detail(req.organization, req.user.userId, id(req))),
  update: wrap((req) => builder.update({ ...ctx(req), id: id(req), input: req.body })),
  publish: wrap((req) => builder.publish({ ...ctx(req), id: id(req) })),
  close: wrap((req) => builder.close({ ...ctx(req), id: id(req) })),
  newVersion: wrap((req) => builder.newVersion({ ...ctx(req), id: id(req) }), 201),
  preview: wrap((req) => builder.preview({ ...ctx(req), id: id(req) })),
  setReviewers: wrap((req) => builder.setReviewers({ ...ctx(req), id: id(req), userIds: req.body.userIds })),
  candidates: wrap((req) => builder.listCandidates({ ...ctx(req), id: id(req) })),
  invite: wrap((req) => builder.invite({ ...ctx(req), id: id(req), applicationIds: req.body.applicationIds })),
  revokeInvitation: wrap((req) => builder.revokeInvitation({ ...ctx(req), id: id(req), invitationId: id(req, 'invitationId') })),
  attempts: wrap((req) => results.listAttempts({ ...ctx(req), id: id(req) })),
  attempt: wrap((req) => results.getAttempt({ ...ctx(req), attemptId: id(req, 'attemptId') })),
  addNote: wrap((req) => results.addNote({ ...ctx(req), attemptId: id(req, 'attemptId'), body: req.body.body })),
  setReviewStatus: wrap((req) => results.setReviewStatus({ ...ctx(req), attemptId: id(req, 'attemptId'), reviewStatus: req.body.reviewStatus })),
  questions: wrap((req) => questionBank.list({ organizationId: req.organization.id, sectionKind: req.query.sectionKind, category: req.query.category, includeArchived: req.query.includeArchived === 'true' })),
  createQuestion: wrap(async (req) => ({ question: await questionBank.create({ organizationId: req.organization.id, userId: req.user.userId, input: req.body }) }), 201),
  updateQuestion: wrap(async (req) => ({ question: await questionBank.update({ organizationId: req.organization.id, id: id(req), input: req.body }) })),
  archiveQuestion: wrap(async (req) => ({ question: await questionBank.setArchived({ organizationId: req.organization.id, id: id(req), archived: req.body.archived !== false }) })),
}
