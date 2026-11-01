// Phase I route guards (static inventory of the real route modules).
const test = require('node:test')
const assert = require('node:assert/strict')
const { build } = require('../helpers/routeInventory')
const routes = build()
const find = (m, p) => routes.find((r) => r.method === m && r.fullPath === p)

test('Run Code needs auth, the candidate role, and a rate limit (each run starts a container)', () => {
  const r = find('POST', '/api/coding/run')
  assert.ok(r, 'route exists')
  for (const g of ['auth', 'role:candidate', 'ratelimit']) assert.ok(r.guards.includes(g), `missing ${g}: ${r.guards}`)
})

test('hint endpoints need auth and the candidate role', () => {
  for (const [m, p] of [['GET', '/api/coding/problems/:id/hints'], ['POST', '/api/coding/problems/:id/hints/next']]) {
    const r = find(m, p); assert.ok(r, `${m} ${p} exists`)
    for (const g of ['auth', 'role:candidate']) assert.ok(r.guards.includes(g), `${m} ${p} missing ${g}`)
  }
})
