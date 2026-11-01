/**
 * Organization-scoped permissions (Phase J). The member role comes from organization_members (re-read from the
 * database on every request by requireApprovedOrganization), never from the token or the request.
 *
 *   view         read applications, jobs and the team list
 *   review       add notes and structured scorecards
 *   manageJobs   create / edit / publish / close / delete jobs, configure assessments
 *   decide       change an application's status (shortlist, reject, hire, reconsider)
 *   manageTeam   invite / remove members, change member roles
 *   viewAudit    read the access audit log
 */
const PERMISSIONS = {
  owner: ['view', 'review', 'manageJobs', 'decide', 'manageTeam', 'viewAudit'],
  recruiter: ['view', 'review', 'manageJobs', 'decide'],
  reviewer: ['view', 'review'],
}
const MEMBER_ROLES = Object.keys(PERMISSIONS)
const INVITABLE_ROLES = ['recruiter', 'reviewer']

const can = (memberRole, permission) => Boolean(PERMISSIONS[memberRole] && PERMISSIONS[memberRole].includes(permission))

module.exports = { PERMISSIONS, MEMBER_ROLES, INVITABLE_ROLES, can }
