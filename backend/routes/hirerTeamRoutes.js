const express = require('express')
const controller = require('../controllers/hiringTeamController')
const { requireAuth } = require('../middleware/auth')
const { requireRole, requireApprovedOrganization, requireOrgPermission } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, inviteRules, memberRoleRules } = require('../middleware/validators')

const router = express.Router()

// Hirer + approved organization; the member role then decides what they may do (see utils/orgPermissions.js).
router.use(requireAuth, requireRole('hirer'), requireApprovedOrganization)

router.get('/', requireOrgPermission('view'), controller.get)
router.post('/invitations', requireOrgPermission('manageTeam'), inviteRules, handleValidationErrors, controller.invite)
router.delete('/invitations/:id', requireOrgPermission('manageTeam'), idParam('id'), handleValidationErrors, controller.revoke)
router.patch('/members/:userId', requireOrgPermission('manageTeam'), idParam('userId'), memberRoleRules, handleValidationErrors, controller.changeRole)
router.delete('/members/:userId', requireOrgPermission('manageTeam'), idParam('userId'), handleValidationErrors, controller.removeMember)

module.exports = router
