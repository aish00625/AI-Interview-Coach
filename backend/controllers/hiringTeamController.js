const { sendSuccess } = require('../utils/apiResponse')
const team = require('../services/hiringTeamService')
const audit = require('../services/auditService')

const org = (req) => req.organization.id

async function get(req, res, next) {
  try { sendSuccess(res, { ...(await team.getTeam({ organizationId: org(req) })), you: { userId: req.user.userId, memberRole: req.organization.member_role } }) } catch (err) { next(err) }
}
async function invite(req, res, next) {
  try {
    const { invitation, inviteToken } = await team.invite({ organizationId: org(req), invitedBy: req.user.userId, email: req.body.email, memberRole: req.body.memberRole })
    // The token is shown exactly once; only its hash is stored.
    sendSuccess(res, { invitation, inviteToken, expiresInDays: team.INVITE_TTL_DAYS }, 201)
  } catch (err) { next(err) }
}
async function revoke(req, res, next) {
  try { await team.revokeInvitation({ organizationId: org(req), id: req.params.id }); sendSuccess(res, { revoked: true }) } catch (err) { next(err) }
}
async function changeRole(req, res, next) {
  try { sendSuccess(res, await team.changeRole({ organizationId: org(req), actorId: req.user.userId, userId: req.params.userId, memberRole: req.body.memberRole })) } catch (err) { next(err) }
}
async function removeMember(req, res, next) {
  try { sendSuccess(res, await team.removeMember({ organizationId: org(req), actorId: req.user.userId, userId: req.params.userId })) } catch (err) { next(err) }
}
async function auditLog(req, res, next) {
  try {
    sendSuccess(res, { entries: await audit.listForOrganization({ organizationId: org(req), applicationId: req.query.applicationId, before: req.query.before, limit: req.query.limit }) })
  } catch (err) { next(err) }
}
module.exports = { get, invite, revoke, changeRole, removeMember, auditLog }
