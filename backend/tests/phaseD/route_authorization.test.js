const test = require('node:test')
const assert = require('node:assert/strict')
const probe = require('../helpers/routeProbe')
probe.install()

test('hirer assessment-config routes are behind auth -> hirer -> approved org', () => {
  const routes = probe.loadRoutes('routes/hirerJobRoutes.js').filter((r) => r.path.endsWith('/assessment'))
  assert.deepEqual(routes.map((r) => r.method).sort(), ['GET', 'PUT'])
  for (const r of routes) assert.deepEqual(r.guards, ['auth', 'role:hirer', 'org', r.method === 'GET' ? 'perm:view' : 'perm:manageJobs'])
})

test('hirer coding catalogue is hirer + approved org only', () => {
  const routes = probe.loadRoutes('routes/hirerCatalogRoutes.js')
  assert.equal(routes.length, 1)
  assert.deepEqual(routes[0].guards, ['auth', 'role:hirer', 'org'])
})

test('starting an interview assessment is candidate-only', () => {
  const r = probe.loadRoutes('routes/applicationRoutes.js').find((x) => x.path === '/:id/assessment/interview')
  assert.ok(r); assert.equal(r.method, 'POST'); assert.deepEqual(r.guards, ['auth', 'role:candidate'])
})
