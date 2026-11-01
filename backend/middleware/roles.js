const { sendError } = require('../utils/apiResponse')
const userModel = require('../models/userModel')
const organizationModel = require('../models/organizationModel')
const { can } = require('../utils/orgPermissions')

/**
 * Role-based authorization. Must run AFTER requireAuth.
 *
 * The role is re-read from the database on every guarded request instead of
 * trusted from the JWT, so demoting a user or changing a role takes effect
 * immediately rather than when their token expires.
 */
function requireRole(...allowedRoles) {
  return async function roleGuard(req, res, next) {
    try {
      const user = await userModel.findUserById(req.user.userId)
      if (!user) return sendError(res, 'Authentication required.', 401)
      if (!allowedRoles.includes(user.role)) {
        return sendError(res, 'You do not have permission to access this resource.', 403)
      }
      req.user.role = user.role
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * For hirer routes that expose candidate data (Phase B onward). Must run
 * after requireRole('hirer'). Blocks hirers whose organization has not been
 * approved by an admin, and attaches req.organization for scoping queries.
 */
async function requireApprovedOrganization(req, res, next) {
  try {
    const org = await organizationModel.getMembershipByUserId(req.user.userId)
    if (!org) return sendError(res, 'No organization is linked to this account.', 403)
    if (org.status !== 'approved') {
      return sendError(res, 'Your organization has not been approved yet.', 403)
    }
    req.organization = org
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Organization-scoped permission check (Phase J). Must run after requireApprovedOrganization, which loads the
 * caller's member role from the database. Fails closed when the role is missing.
 */
function requireOrgPermission(permission) {
  return function orgPermissionGuard(req, res, next) {
    const role = req.organization && req.organization.member_role
    if (!role || !can(role, permission)) {
      return sendError(res, 'Your role in this organization does not allow that action.', 403)
    }
    next()
  }
}

module.exports = { requireRole, requireApprovedOrganization, requireOrgPermission }
