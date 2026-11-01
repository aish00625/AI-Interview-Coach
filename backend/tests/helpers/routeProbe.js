// Loads route modules with a recording stub of express.Router so tests can assert, WITHOUT npm/express,
// which guard middleware (auth / role / approved-org) is in front of every route.
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')

const chain = new Proxy(function () {}, { get: (_t, k) => (k === 'then' || k === 'guard' ? undefined : chain), apply: () => chain })
const mark = (guard) => { const f = (req, res, next) => next(); f.guard = guard; return f }

function install() {
  stubModule('express-rate-limit', () => mark('ratelimit'))
  stubModule('config/db', { pool: { query: async () => ({ rows: [] }), connect: async () => ({}) }, checkConnection: async () => {} })
  stubModule('express-validator', { body: () => chain, param: () => chain, query: () => chain, validationResult: () => ({ isEmpty: () => true, array: () => [] }) })
  stubModule(path.join(root, 'middleware/auth'), { requireAuth: mark('auth') })
  stubModule(path.join(root, 'middleware/resumeUpload'), { uploadResume: mark('upload'), MAX_RESUME_BYTES: 5 * 1024 * 1024 })
  stubModule(path.join(root, 'middleware/roles'), {
    requireRole: (...r) => mark(`role:${r.join('|')}`),
    requireApprovedOrganization: mark('org'),
    requireOrgPermission: (perm) => mark(`perm:${perm}`),
  })
  stubModule('express', {
    Router() {
      const global = []; const routes = []
      const r = { global, routes, use: (...m) => { global.push(...m.flat()) } }
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        r[method] = (p, ...m) => { routes.push({ method: method.toUpperCase(), path: p, mws: [...global, ...m.flat()] }) }
      }
      return r
    },
    json: () => mark('json'),
  })
}

/** Returns [{ method, path, guards:[...], handler }] for a route module path relative to backend root. */
function loadRoutes(rel) {
  const router = require(path.join(root, rel))
  return router.routes.map((r) => ({
    method: r.method, path: r.path,
    guards: r.mws.map((m) => m.guard).filter(Boolean),
    handler: r.mws[r.mws.length - 1],
  }))
}
module.exports = { install, loadRoutes }
