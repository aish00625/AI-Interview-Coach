const test = require('node:test')
const assert = require('node:assert/strict')
const probe = require('../helpers/routeProbe')
probe.install()

test('resume routes: auth -> candidate role on every route; upload middleware only on POST /', () => {
  const routes = probe.loadRoutes('routes/resumeRoutes.js')
  assert.equal(routes.length, 6) // + GET /:id/skills (Phase I)
  for (const r of routes) {
    assert.deepEqual(r.guards.slice(0, 2), ['auth', 'role:candidate'], `${r.method} ${r.path}`)
    assert.equal(r.guards.includes('upload'), r.method === 'POST', `${r.method} ${r.path}`)
    assert.equal(r.guards.includes('ratelimit'), r.method === 'POST', 'upload endpoint is rate limited')
  }
})

test('application routes: auth -> candidate role on every route', () => {
  const routes = probe.loadRoutes('routes/applicationRoutes.js')
  assert.equal(routes.length, 7) // list, apply, get, withdraw, start interview assessment (D), consent, access-log (J)
  for (const r of routes) assert.deepEqual(r.guards, ['auth', 'role:candidate'], `${r.method} ${r.path}`)
})
