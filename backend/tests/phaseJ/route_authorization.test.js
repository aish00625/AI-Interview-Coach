const test = require('node:test')
const assert = require('node:assert/strict')
const routeInventory = require('../helpers/routeInventory')
const { PERMISSIONS, can, MEMBER_ROLES, INVITABLE_ROLES } = require('../../utils/orgPermissions')
const { canonicalEmail } = require('../../utils/emailCanonical')
const { REJECTION_REASONS, labelFor } = require('../../utils/rejectionReasons')
const { normalizeCriteria, validateScorecard, DEFAULT_CRITERIA } = require('../../utils/scorecard')

const routes = routeInventory.build()
const find = (m, p) => routes.find((r) => r.method === m && r.fullPath === p)
const permOf = (r) => (r.guards.find((g) => g.startsWith('perm:')) || '').slice(5)

test('permission matrix: owner > recruiter > reviewer, nothing implicit', () => {
  assert.deepEqual(MEMBER_ROLES.sort(), ['owner', 'recruiter', 'reviewer'])
  assert.deepEqual(INVITABLE_ROLES, ['recruiter', 'reviewer'], 'ownership is granted by an existing owner, never by invitation')
  const expect = {
    owner: ['view', 'review', 'manageJobs', 'decide', 'manageTeam', 'viewAudit'],
    recruiter: ['view', 'review', 'manageJobs', 'decide'],
    reviewer: ['view', 'review'],
  }
  assert.deepEqual(PERMISSIONS, expect)
  for (const [role, perms] of Object.entries(expect)) for (const p of ['view', 'review', 'manageJobs', 'decide', 'manageTeam', 'viewAudit']) assert.equal(can(role, p), perms.includes(p), `${role}:${p}`)
  assert.equal(can('admin', 'view'), false); assert.equal(can(undefined, 'view'), false); assert.equal(can('owner', 'nonexistent'), false)
})

test('every /api/hirer route except the problem catalogue carries an organization permission that exists', () => {
  const hirer = routes.filter((r) => r.fullPath.startsWith('/api/hirer/') && r.fullPath !== '/api/hirer/coding-problems')
  assert.ok(hirer.length >= 22, `found ${hirer.length}`)
  for (const r of hirer) {
    assert.deepEqual(r.guards.slice(0, 3), ['auth', 'role:hirer', 'org'], `${r.method} ${r.fullPath}`)
    assert.ok(Object.values(PERMISSIONS).flat().includes(permOf(r)), `${r.method} ${r.fullPath} has permission "${permOf(r)}"`)
  }
})

test('reads need "view"; job writes "manageJobs"; status changes "decide"; team and audit are owner-only; notes and scorecards "review"', () => {
  for (const r of routes.filter((x) => x.fullPath.startsWith('/api/hirer/jobs') && x.fullPath !== '/api/hirer/coding-problems')) assert.equal(permOf(r), r.method === 'GET' ? 'view' : 'manageJobs', `${r.method} ${r.fullPath}`)
  assert.equal(permOf(find('POST', '/api/hirer/applications/:id/status')), 'decide')
  assert.equal(permOf(find('POST', '/api/hirer/applications/:id/notes')), 'review')
  assert.equal(permOf(find('POST', '/api/hirer/applications/:id/scorecard')), 'review')
  assert.equal(permOf(find('GET', '/api/hirer/applications/:id/resume')), 'view')
  for (const [m, p] of [['POST', '/api/hirer/team/invitations'], ['DELETE', '/api/hirer/team/invitations/:id'], ['PATCH', '/api/hirer/team/members/:userId'], ['DELETE', '/api/hirer/team/members/:userId']]) assert.equal(permOf(find(m, p)), 'manageTeam', `${m} ${p}`)
  assert.equal(permOf(find('GET', '/api/hirer/team')), 'view')
  assert.equal(permOf(find('GET', '/api/hirer/audit-log')), 'viewAudit')
})

test('candidate consent and access-log routes are candidate-only; notifications and account need a login but own data only', () => {
  for (const [m, p] of [['POST', '/api/applications/:id/consent'], ['GET', '/api/applications/:id/access-log']]) assert.deepEqual(find(m, p).guards, ['auth', 'role:candidate'])
  for (const r of routes.filter((x) => x.fullPath.startsWith('/api/notifications'))) assert.deepEqual(r.guards, ['auth'], `${r.method} ${r.fullPath}`)
  assert.equal(routes.filter((x) => x.fullPath.startsWith('/api/notifications')).length, 4)
  for (const r of routes.filter((x) => x.fullPath.startsWith('/api/account'))) { assert.equal(r.guards[0], 'auth'); assert.ok(r.guards.includes('ratelimit'), `${r.method} ${r.fullPath} is rate limited`) }
  assert.equal(routes.filter((x) => x.fullPath.startsWith('/api/account')).length, 2)
})

test('canonical e-mail matches what registration normalisation produces for Gmail-style addresses', () => {
  assert.equal(canonicalEmail(' Jane.Doe+work@Gmail.com '), 'janedoe@gmail.com')
  assert.equal(canonicalEmail('a.b@googlemail.com'), 'ab@gmail.com')
  assert.equal(canonicalEmail('First.Last+x@Company.IO'), 'first.last+x@company.io', 'only Gmail dots/plus are folded')
})

test('rejection reasons: every code has candidate-safe wording; only "other" demands an explanation', () => {
  assert.deepEqual(Object.keys(REJECTION_REASONS).sort(), ['assessment_review', 'experience_mismatch', 'incomplete_application', 'other', 'position_filled', 'skills_mismatch'])
  for (const [code, r] of Object.entries(REJECTION_REASONS)) { assert.ok(labelFor(code).length > 20); assert.equal(r.requiresNote, code === 'other'); assert.equal(/score|ai |automated/i.test(r.label) && code !== 'assessment_review', false) }
  assert.equal(labelFor('nope'), null)
})

test('scorecard validation (pure): criteria normalisation and rating rules', () => {
  assert.equal(normalizeCriteria(undefined), null); assert.equal(normalizeCriteria([]), null)
  assert.deepEqual(normalizeCriteria([' System design ', 'Team work!']), [{ key: 'system_design', label: 'System design' }, { key: 'team_work', label: 'Team work!' }])
  assert.throws(() => normalizeCriteria('x'), { statusCode: 400 }); assert.throws(() => normalizeCriteria(['a', 'A']), { statusCode: 400 })
  assert.throws(() => normalizeCriteria(Array.from({ length: 9 }, (_, i) => `c${i}`)), { statusCode: 400 }); assert.throws(() => normalizeCriteria(['  ']), { statusCode: 400 })
  const ratings = DEFAULT_CRITERIA.map((c) => ({ key: c.key, rating: 3 }))
  const ok = validateScorecard({ criteria: DEFAULT_CRITERIA, ratings, recommendation: 'yes', summary: '  ok ' })
  assert.equal(ok.summary, 'ok'); assert.equal(ok.ratings.length, 4)
  for (const bad of [{ ratings: ratings.slice(1) }, { ratings: ratings.map((r) => ({ ...r, rating: 0 })) }, { ratings: ratings.map((r) => ({ ...r, rating: 2.5 })) }, { recommendation: 'meh' }]) {
    assert.throws(() => validateScorecard({ criteria: DEFAULT_CRITERIA, ratings, recommendation: 'yes', ...bad }), { statusCode: 400 })
  }
})
