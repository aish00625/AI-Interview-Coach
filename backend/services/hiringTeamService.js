const crypto = require('crypto')
const model = require('../models/hiringTeamModel')
const userModel = require('../models/userModel')
const accountModel = require('../models/accountModel')
const { pool } = require('../config/db')
const { INVITABLE_ROLES, MEMBER_ROLES } = require('../utils/orgPermissions')
const { canonicalEmail } = require('../utils/emailCanonical')

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS) || 7
const MAX_LIVE_INVITATIONS = 20
const MAX_MEMBERS = 25

function httpError(statusCode, message) { const e = new Error(message); e.statusCode = statusCode; return e }
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

async function getTeam({ organizationId }) {
  const [members, invitations] = await Promise.all([model.listMembers(organizationId), model.listLiveInvitations(organizationId)])
  return { members, invitations }
}

/**
 * Creates a single-use invitation. There is no e-mail service in this project, so the one-time token is returned to the
 * inviting owner ONCE (to be sent through any channel they choose) and only its hash is stored. The invitee registers
 * with that token; the registration e-mail must match the invited address.
 */
async function invite({ organizationId, invitedBy, email, memberRole }) {
  const address = canonicalEmail(email)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) || address.length > 255) throw httpError(400, 'Enter a valid e-mail address.')
  if (!INVITABLE_ROLES.includes(memberRole)) throw httpError(400, `Role must be one of: ${INVITABLE_ROLES.join(', ')}.`)
  if (await userModel.findUserByEmail(address)) {
    throw httpError(409, 'An account with that e-mail already exists. Invitations create a new hiring account, so use a different address.')
  }
  const [live, members] = await Promise.all([model.countLiveInvitations(organizationId), model.listMembers(organizationId)])
  if (live >= MAX_LIVE_INVITATIONS) throw httpError(409, `You can have at most ${MAX_LIVE_INVITATIONS} pending invitations.`)
  if (members.length + live >= MAX_MEMBERS) throw httpError(409, `A team can have at most ${MAX_MEMBERS} members.`)

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000)
  try {
    const invitation = await model.createInvitation({ organizationId, email: address, memberRole, tokenHash: hashToken(token), invitedBy, expiresAt })
    return { invitation, inviteToken: token }
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'There is already a pending invitation for that e-mail. Revoke it first to send a new one.')
    throw err
  }
}

async function revokeInvitation({ organizationId, id }) {
  if (!(await model.revokeInvitation({ organizationId, id }))) throw httpError(404, 'Invitation not found.')
}

async function changeRole({ organizationId, actorId, userId, memberRole }) {
  if (!MEMBER_ROLES.includes(memberRole)) throw httpError(400, `Role must be one of: ${MEMBER_ROLES.join(', ')}.`)
  if (String(userId) === String(actorId)) throw httpError(409, 'You cannot change your own role. Ask another owner.')
  const target = await model.getMember(organizationId, userId)
  if (!target) throw httpError(404, 'Team member not found.')
  await model.setMemberRole({ organizationId, userId, memberRole })
  return getTeam({ organizationId })
}

async function removeMember({ organizationId, actorId, userId }) {
  if (String(userId) === String(actorId)) throw httpError(409, 'You cannot remove yourself from the team.')
  const target = await model.getMember(organizationId, userId)
  if (!target) throw httpError(404, 'Team member not found.')
  if (target.member_role === 'owner') throw httpError(409, 'Change this owner\'s role before removing them.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Jobs they created stay with the organization (created_by moves to the owner doing the removal).
    await accountModel.reassignCreator({ organizationId, fromUserId: userId, toUserId: actorId }, client)
    await model.removeMember({ organizationId, userId }, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return getTeam({ organizationId })
}

/** Used by registration (inside its transaction). Throws a generic 400 for any unusable token so tokens cannot be probed. */
async function consumeInvitation({ token, email, userId, client }) {
  const bad = () => httpError(400, 'This invitation is invalid, expired or already used.')
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw bad()
  const inv = await model.getByTokenHashForUpdate(hashToken(token), client)
  if (!inv || inv.accepted_at || inv.revoked_at || new Date(inv.expires_at) <= new Date()) throw bad()
  if (canonicalEmail(inv.email) !== canonicalEmail(email)) throw bad()
  if (['rejected', 'suspended'].includes(inv.organization_status)) throw httpError(403, 'This organization cannot accept new members.')
  await model.markAccepted({ id: inv.id, userId }, client)
  return { organizationId: inv.organization_id, memberRole: inv.member_role, organizationStatus: inv.organization_status }
}

module.exports = { getTeam, invite, revokeInvitation, changeRole, removeMember, consumeInvitation, hashToken, INVITE_TTL_DAYS, MAX_LIVE_INVITATIONS }
