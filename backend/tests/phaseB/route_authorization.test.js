const test = require('node:test')
const assert = require('node:assert/strict')
const probe = require('../helpers/routeProbe')
probe.install()

test('every hirer job route requires auth -> hirer role -> approved organization (in that order)', () => {
  const routes = probe.loadRoutes('routes/hirerJobRoutes.js')
  assert.ok(routes.length >= 6)
  for (const r of routes) {
    assert.deepEqual(r.guards.slice(0, 3), ['auth', 'role:hirer', 'org'], `${r.method} ${r.path}`)
    assert.match(r.guards[3], /^perm:(view|manageJobs)$/, `${r.method} ${r.path} needs an organization permission (Phase J)`)
    assert.equal(r.guards[3], r.method === 'GET' ? 'perm:view' : 'perm:manageJobs', 'reads need view; every write needs manageJobs')
    assert.equal(typeof r.handler, 'function')
  }
})

test('every candidate job route requires auth -> candidate role, and exposes only GETs', () => {
  const routes = probe.loadRoutes('routes/jobRoutes.js')
  assert.equal(routes.length, 3) // list, detail, fit (Phase I)
  for (const r of routes) {
    assert.deepEqual(r.guards, ['auth', 'role:candidate'])
    assert.equal(r.method, 'GET')
  }
})

test('admin routes all require admin role', () => {
  for (const r of probe.loadRoutes('routes/adminRoutes.js')) assert.deepEqual(r.guards, ['auth', 'role:admin'], r.path)
})
