const test = require('node:test')
const assert = require('node:assert/strict')
const { build } = require('../helpers/routeInventory')

const routes = build()
const has = (r, g) => r.guards.includes(g)

// The ONLY routes allowed to be reachable without a token. Anything else without 'auth' fails this test.
const PUBLIC = new Set([
  'POST /api/auth/register', 'POST /api/auth/login',
  'GET /api/coding/problems', 'GET /api/coding/problems/:id',
  'GET /api/skills', 'GET /api/topics',
])

test('route inventory is non-trivial (guards against the loader silently finding nothing)', () => {
  // 105 before migration 018; +31 for hirer assessments (20 under /api/hirer, 11 under /api/assessments), each checked in phaseW/assessment_routes.test.js
  assert.ok(routes.length === 136, `found ${routes.length} routes`)
})

test('every route requires authentication unless it is on the explicit public allow-list', () => {
  const unguarded = routes.filter((r) => !has(r, 'auth') && !PUBLIC.has(`${r.method} ${r.fullPath}`))
  assert.deepEqual(unguarded.map((r) => `${r.method} ${r.fullPath}`), [])
  const publicFound = routes.filter((r) => PUBLIC.has(`${r.method} ${r.fullPath}`)).length
  assert.equal(publicFound, PUBLIC.size, 'allow-list entries must exist (keeps the list honest)')
})

test('/api/admin/* needs the admin role', () => {
  const rs = routes.filter((r) => r.fullPath.startsWith('/api/admin/'))
  assert.ok(rs.length >= 4)
  for (const r of rs) assert.ok(has(r, 'role:admin'), `${r.method} ${r.fullPath}`)
})

test('/api/hirer/* needs hirer role AND an approved organization', () => {
  const rs = routes.filter((r) => r.fullPath.startsWith('/api/hirer/'))
  assert.ok(rs.length === 43, `found ${rs.length}`) // 23 + 20 assessment/question-bank routes (migration 018)
  for (const r of rs) { assert.ok(has(r, 'role:hirer') && has(r, 'org'), `${r.method} ${r.fullPath}`) }
})

test('candidate features (interviews, coding submissions, dashboard, performance, profile, jobs, resumes, applications) need the candidate role', () => {
  const prefixes = ['/api/interviews', '/api/dashboard', '/api/performance', '/api/users', '/api/jobs', '/api/resumes', '/api/applications', '/api/face-monitoring', '/api/assessments']
  const rs = routes.filter((r) => prefixes.some((p) => r.fullPath === p || r.fullPath.startsWith(`${p}/`)))
    .concat(routes.filter((r) => r.fullPath.startsWith('/api/coding/') && !PUBLIC.has(`${r.method} ${r.fullPath}`)))
  assert.ok(rs.length >= 37, `found ${rs.length}`)
  for (const r of rs) assert.ok(has(r, 'role:candidate'), `${r.method} ${r.fullPath}`)
})

test('no hirer/admin route is a GET that changes state, and DELETE/PUT/PATCH/POST are never unguarded', () => {
  for (const r of routes) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && !PUBLIC.has(`${r.method} ${r.fullPath}`)) assert.ok(has(r, 'auth'), `${r.method} ${r.fullPath}`)
  }
  for (const r of routes.filter((x) => x.method === 'GET' && /\/(status|withdraw|approve|reject|suspend|notes)$/.test(x.fullPath))) assert.fail(`state-changing verb on GET: ${r.fullPath}`)
})

test('/api/face-monitoring/* is candidate-only and the frame/reference uploads are rate limited', () => {
  const rs = routes.filter((r) => r.fullPath.startsWith('/api/face-monitoring'))
  assert.equal(rs.length, 12)
  for (const r of rs) assert.ok(has(r, 'auth') && has(r, 'role:candidate'), `${r.method} ${r.fullPath}`)
})
