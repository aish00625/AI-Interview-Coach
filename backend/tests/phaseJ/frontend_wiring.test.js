// Static checks that the Phase J screens actually call the APIs they depend on (a page that renders but never calls
// the server is the failure mode these guard against). Source-level only: the React build has not been run here.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const src = (p) => fs.readFileSync(path.join(__dirname, '../../../frontend/src', p), 'utf8')

test('apply sends BOTH consent flags and refuses to submit without the required one', () => {
  const s = src('components/ApplyPanel.jsx')
  assert.match(s, /consentShareResume: true/); assert.match(s, /consentShareAssessment: consentAssessment/)
  assert.match(s, /if \(!consentResume\)/)
})
test('review page: scorecard panel, reject dialog with a required reason, withheld/blind notices', () => {
  const s = src('pages/HirerApplicationReview.jsx')
  assert.match(s, /ScorecardPanel/); assert.match(s, /RejectDialog/); assert.match(s, /setRejecting\(true\)/)
  assert.match(s, /reasonCode/); assert.match(s, /identityHidden/); assert.match(s, /withheld\?\.resume/)
  assert.equal(/window\.confirm\('Reject this application\?'\)/.test(s), false, 'the old confirm-only rejection is gone')
  assert.match(src('components/RejectDialog.jsx'), /requiresNote/)
  assert.match(src('components/ScorecardPanel.jsx'), /hirerApplicationApi\.submitScorecard/)
})
test('team, audit log, notifications and account pages call their endpoints', () => {
  const team = src('pages/HirerTeam.jsx'); for (const fn of ['hirerTeamApi.get', 'hirerTeamApi.invite', 'hirerTeamApi.revokeInvitation', 'hirerTeamApi.setRole', 'hirerTeamApi.removeMember']) assert.ok(team.includes(fn), fn)
  assert.match(team, /register\?invite=/)
  assert.match(src('pages/HirerAuditLog.jsx'), /hirerTeamApi\.auditLog/)
  const n = src('pages/Notifications.jsx'); for (const fn of ['notificationApi.list', 'notificationApi.markRead', 'notificationApi.markAllRead']) assert.ok(n.includes(fn), fn)
  const a = src('pages/Account.jsx'); assert.ok(a.includes('accountApi.exportData') && a.includes('accountApi.deleteAccount'))
  assert.match(src('components/Sidebar.jsx'), /notificationApi\.unreadCount/)
})
test('application page shows consent state, can grant it, shows the rejection reason and the access log; assessment start needs consent', () => {
  const s = src('pages/ApplicationDetail.jsx')
  assert.match(s, /applicationApi\.grantConsent/); assert.match(s, /applicationApi\.accessLog/); assert.match(s, /h\.reason/)
  assert.ok((s.match(/app\.consent\?\.assessment &&/g) || []).length >= 3, 'start / continue / coding buttons all require assessment consent')
})
test('registration understands invitation links; the job form exposes blind review and scorecard criteria', () => {
  const r = src('pages/Register.jsx'); assert.match(r, /inviteToken/); assert.match(r, /\[0-9a-f\]\{64\}/)
  const j = src('pages/HirerJobForm.jsx'); assert.match(j, /blindReview/); assert.match(j, /scorecardCriteria/)
})
test('owner-only nav items are filtered by member role; every Phase J page is routed', () => {
  assert.match(src('components/Sidebar.jsx'), /ownerOnly/)
  const app = src('App.jsx'); for (const p of ['/hirer/team', '/hirer/audit-log', '/notifications', '/account']) assert.ok(app.includes(`path="${p}"`), p)
})
