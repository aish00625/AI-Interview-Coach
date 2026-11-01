const { pool } = require('../config/db')

/**
 * Hiring organizations (Phase A). Every query is parameterized. A hirer's
 * access to candidate data (Phase B onward) is gated on the organization's
 * status being 'approved'.
 */

async function createOrganization({ name, createdBy }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO organizations (name, created_by)
     VALUES ($1, $2)
     RETURNING id, name, status, created_at`,
    [name, createdBy],
  )
  return rows[0]
}

async function addMember({ organizationId, userId, memberRole = 'owner' }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO organization_members (organization_id, user_id, member_role)
     VALUES ($1, $2, $3)
     RETURNING organization_id, user_id, member_role`,
    [organizationId, userId, memberRole],
  )
  return rows[0]
}

/** The organization a user belongs to (with their member role), or null. */
async function getMembershipByUserId(userId, client = pool) {
  const { rows } = await client.query(
    `SELECT o.id, o.name, o.status, m.member_role
       FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = $1`,
    [userId],
  )
  return rows[0] || null
}

/** Admin listing. `status` is optional; owner contact details are included for review. */
async function listOrganizations({ status = null } = {}) {
  const { rows } = await pool.query(
    `SELECT o.id, o.name, o.status, o.created_at, o.reviewed_at,
            u.name AS owner_name, u.email AS owner_email
       FROM organizations o
       JOIN users u ON u.id = o.created_by
      WHERE ($1::text IS NULL OR o.status = $1)
      ORDER BY o.created_at DESC, o.id DESC`,
    [status],
  )
  return rows
}

/** Returns the updated row, or null if the id doesn't exist. */
async function setOrganizationStatus({ id, status, reviewedBy }) {
  const { rows } = await pool.query(
    `UPDATE organizations
        SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1
      RETURNING id, name, status, reviewed_at`,
    [id, status, reviewedBy],
  )
  return rows[0] || null
}

module.exports = { createOrganization, addMember, getMembershipByUserId, listOrganizations, setOrganizationStatus }
