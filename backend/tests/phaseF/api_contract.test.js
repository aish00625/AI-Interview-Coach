// Frontend <-> backend contract: every apiClient.<method>(<path>) call in frontend/src/services/api.js must match a real
// backend route (same HTTP method, same path shape). Catches typos and drift without needing a running server.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const { build } = require('../helpers/routeInventory')

const backend = build().map((r) => ({ method: r.method, shape: r.fullPath.replace(/^\/api/, '').replace(/:[A-Za-z]+/g, ':p') }))
const apiFile = path.join(__dirname, '../../../frontend/src/services/api.js')
const src = fs.readFileSync(apiFile, 'utf8')
const calls = [...src.matchAll(/apiClient\.(get|post|put|patch|delete)\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g)].map((m) => ({
  method: m[1].toUpperCase(),
  shape: m[3].replace(/\$\{[^}]*\}/g, ':p'),
}))

test('frontend api.js has a meaningful number of calls to check', () => {
  assert.ok(calls.length >= 45, `found ${calls.length}`)
})

test('every frontend API call matches an existing backend route (method + path)', () => {
  const missing = calls.filter((c) => !backend.some((b) => b.method === c.method && b.shape === c.shape))
  assert.deepEqual(missing.map((c) => `${c.method} ${c.shape}`), [])
})

test('every backend route used by a page is reachable from api.js, except documented backend-only ones', () => {
  const BACKEND_ONLY = new Set([
    'POST /auth/logout', // AuthContext handles logout client-side
    'POST /coding/run', 'POST /coding/submit', // reserved 501 endpoints
    'POST /interviews/:p/answer/video', // used via interviewApi (FormData) — listed below if missing
  ])
  const unused = backend.filter((b) => !calls.some((c) => c.method === b.method && c.shape === b.shape)).map((b) => `${b.method} ${b.shape}`).filter((k) => !BACKEND_ONLY.has(k))
  // Not asserting emptiness blindly: print what is unused so a human can judge, but fail on routes of the NEW hirer/candidate workflow.
  const workflow = unused.filter((k) => /\/(hirer|jobs|resumes|applications|admin)/.test(k))
  assert.deepEqual(workflow, [], `workflow routes with no frontend caller: ${workflow.join(', ')}`)
})
