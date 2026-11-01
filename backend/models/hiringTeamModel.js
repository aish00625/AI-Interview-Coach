const { pool } = require('../config/db')

/** Hiring-team members and invitations (Phase J). Every function is scoped by organizationId from req.organization. */

async function listMembers(organizationId) {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.email, m.member_role, m.created_at
       FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1
      ORDER BY (m.member_role = 'owner') DESC, m.created_at, u.id`,
    [organizationId],
  )
  return rows
}

async function getMember(organizationId, userId, client = pool) {
  const { rows } = await client.query(
    'SELECT user_id, member_role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  )
  return rows[0] || null
}

async function countOwners(organizationId, client = pool) {
  const { rows } = await client.query("SELECT count(*)::int AS n FROM organization_members WHERE organization_id = $1 AND member_role = 'owner'", [organizationId])
  return rows[0].n
}

async function setMemberRole({ organizationId, userId, memberRole }, client = pool) {
  const { rows } = await client.query(
    'UPDATE organization_members SET member_role = $3 WHERE organization_id = $1 AND user_id = $2 RETURNING user_id, member_role',
    [organizationId, userId, memberRole],
  )
  return rows[0] || null
}

async function removeMember({ organizationId, userId }, client = pool) {
  const { rows } = await client.query('DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2 RETURNING user_id', [organizationId, userId])
  return rows.length > 0
}

/* ------------------------------ invitations ------------------------------ */

const INVITE_COLUMNS = 'i.id, i.email, i.member_role, i.expires_at, i.created_at, i.accepted_at, i.revoked_at'

async function createInvitation({ organizationId, email, memberRole, tokenHash, invitedBy, expiresAt }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO organization_invitations (organization_id, email, member_role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, member_role, expires_at, created_at`,
    [organizationId, email, memberRole, tokenHash, invitedBy, expiresAt],
  )
  return rows[0]
}

/** Invitations that can still be accepted. */
async function listLiveInvitations(organizationId) {
  const { rows } = await pool.query(
    `SELECT ${INVITE_COLUMNS}, u.name AS invited_by_name
       FROM organization_invitations i LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.organization_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
      ORDER BY i.id DESC`,
    [organizationId],
  )
  return rows
}

async function countLiveInvitations(organizationId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM organization_invitations WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()',
    [organizationId],
  )
  return rows[0].n
}

async function revokeInvitation({ organizationId, id }) {
  const { rows } = await pool.query(
    `UPDATE organization_invitations SET revoked_at = now()
      WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [id, organizationId],
  )
  return rows.length > 0
}

/** Locks the invitation row for acceptance. */
async function getByTokenHashForUpdate(tokenHash, client) {
  const { rows } = await client.query(
    `SELECT i.id, i.organization_id, i.email, i.member_role, i.expires_at, i.accepted_at, i.revoked_at, o.status AS organization_status
       FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id
      WHERE i.token_hash = $1 FOR UPDATE OF i`,
    [tokenHash],
  )
  return rows[0] || null
}

async function markAccepted({ id, userId }, client) {
  await client.query('UPDATE organization_invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1', [id, userId])
}

module.exports = {
  listMembers, getMember, countOwners, setMemberRole, removeMember,
  createInvitation, listLiveInvitations, countLiveInvitations, revokeInvitation, getByTokenHashForUpdate, markAccepted,
}
