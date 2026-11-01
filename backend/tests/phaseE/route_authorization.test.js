const test = require('node:test')
const assert = require('node:assert/strict')
const probe = require('../helpers/routeProbe')
probe.install()

test('every hirer application route is behind auth -> hirer -> approved organization', () => {
  const routes = probe.loadRoutes('routes/hirerApplicationRoutes.js')
  assert.equal(routes.length, 6) // + scorecard (Phase J)
  for (const r of routes) assert.deepEqual(r.guards.slice(0, 3), ['auth', 'role:hirer', 'org'], `${r.method} ${r.path}`)
  const need = (suffix) => routes.find((r) => r.path.endsWith(suffix)).guards[3]
  assert.equal(need('/status'), 'perm:decide', 'only recruiters/owners change statuses')
  assert.equal(need('/notes'), 'perm:review'); assert.equal(need('/scorecard'), 'perm:review')
  assert.equal(need('/resume'), 'perm:view'); assert.equal(need('/dashboard'), 'perm:view')
  const status = routes.find((r) => r.path.endsWith('/status'))
  assert.equal(status.method, 'POST', 'state changes are never GET')
})

test('applicant list and compare routes (job scoped) carry the same guards', () => {
  const routes = probe.loadRoutes('routes/hirerJobRoutes.js').filter((r) => /applications|compare/.test(r.path))
  assert.equal(routes.length, 2)
  for (const r of routes) { assert.equal(r.method, 'GET'); assert.deepEqual(r.guards, ['auth', 'role:hirer', 'org', 'perm:view']) }
})

test('NO candidate-role or public route can reach hirer application data: only hirer route files import the review controller', () => {
  const fs = require('fs'); const path = require('path')
  const dir = path.join(__dirname, '../../routes')
  const users = fs.readdirSync(dir).filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('hirerApplicationController'))
  assert.deepEqual(users.sort(), ['hirerApplicationRoutes.js', 'hirerJobRoutes.js'])
})
