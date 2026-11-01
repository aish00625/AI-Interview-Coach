// A minimal in-process "Express" for tests: loads the REAL route modules (real guards, real controllers, real services,
// real SQL against the test PostgreSQL) under a recording express.Router stub, and dispatches requests through the
// matching middleware chain in registration order. Not stubbed: requireAuth, requireRole, requireApprovedOrganization,
// controllers, services, models, errorHandler. Stubbed (not installable here): express itself, express-validator
// (rules are NOT executed), multer (the test supplies req.file), bcryptjs/jsonwebtoken (deterministic fakes).
const fs = require('fs'); const path = require('path'); const { Writable } = require('stream')
const { stubModule, root } = require('../phaseA/helpers')

function install(testPool) {
  process.env.JWT_SECRET = 'test-secret'
  // A validation chain is both a builder (body('x').isInt()...) and, once in a route, a middleware (req, res, next).
  const noopChain = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? undefined : noopChain),
    apply: (_t, _this, args) => (args.length === 3 && args[0] && typeof args[0] === 'object' && 'headers' in args[0] && typeof args[2] === 'function' ? args[2]() : noopChain),
  })
  stubModule('config/db', { pool: testPool, checkConnection: async () => {} })
  stubModule('express-validator', { body: () => noopChain, param: () => noopChain, query: () => noopChain, validationResult: () => ({ isEmpty: () => true, array: () => [] }) })
  stubModule('express-rate-limit', () => (req, res, next) => next())
  stubModule('bcryptjs', { hash: async (pw) => `hash(${pw})`, compare: async (pw, h) => h === `hash(${pw})` })
  stubModule('jsonwebtoken', {
    sign: (payload) => `T.${Buffer.from(JSON.stringify(payload)).toString('base64')}`,
    verify: (t) => { if (!/^T\./.test(t)) { const e = new Error('bad'); e.name = 'JsonWebTokenError'; throw e } return JSON.parse(Buffer.from(t.slice(2), 'base64').toString()) },
  })
  for (const lib of ['axios', 'dotenv', 'form-data', 'multer']) stubModule(lib, {})
  // upload middleware: the test provides the "uploaded" file as req.__file (same shape multer's memoryStorage gives).
  stubModule(path.join(root, 'middleware/resumeUpload'), {
    uploadResume: (req, res, next) => (req.__file ? ((req.file = req.__file), next()) : res.status(400).json({ success: false, message: 'A resume file is required (field name "resume").' })),
  })
  stubModule(path.join(root, 'middleware/audioUpload'), { uploadAudio: { single: () => (q, r, n) => n() }, requireAudioFile: (q, r, n) => n() })
  stubModule(path.join(root, 'middleware/videoUpload'), { uploadVideo: { single: () => (q, r, n) => n() }, requireVideoFile: (q, r, n) => n() })
  stubModule(path.join(root, 'middleware/faceFrameUpload'), {
    uploadFaceFrame: { single: () => (req, res, next) => { if (req.__file) req.file = req.__file; next() } },
    requireFaceFrame: (req, res, next) => (req.file ? next() : res.status(400).json({ success: false, message: 'A camera frame is required (field name "frame").' })),
  })
  stubModule('express', {
    Router() {
      const global = []; const routes = []
      const r = { routes, use: (...m) => { global.push(...m.flat()) } }
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) r[method] = (p, ...m) => { routes.push({ method: method.toUpperCase(), path: p, mws: [...global, ...m.flat()] }) }
      return r
    },
    json: () => (q, r, n) => n(),
  })

  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
  const fileByVar = {}
  for (const m of app.matchAll(/const (\w+) = require\('\.\/routes\/(\w+)'\)/g)) fileByVar[m[1]] = m[2]
  const table = []
  for (const m of app.matchAll(/app\.use\('(\/api\/[^']*)',\s*(\w+)\)/g)) {
    const router = require(path.join(root, 'routes', `${fileByVar[m[2]]}.js`))
    for (const r of router.routes) {
      const full = (m[1] + (r.path === '/' ? '' : r.path))
      const keys = []
      const re = new RegExp(`^${full.replace(/:([A-Za-z]+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`)
      table.push({ method: r.method, re, keys, mws: r.mws, full })
    }
  }
  const errorHandler = require(path.join(root, 'middleware/errorHandler.js'))

  class MockRes extends Writable {
    constructor() { super(); this.statusCode = 200; this.headers = {}; this.chunks = []; this.body = undefined; this.done = new Promise((r) => { this._resolve = r }) }
    _write(chunk, _e, cb) { this.chunks.push(Buffer.from(chunk)); cb() }
    status(c) { this.statusCode = c; return this }
    setHeader(k, v) { this.headers[k.toLowerCase()] = v }
    json(b) { this.body = b; this.end(); return this }
    _final(cb) { this._resolve(); cb() }
    get buffer() { return Buffer.concat(this.chunks) }
  }

  async function request(method, url, { token, body = {}, query = {}, file } = {}) {
    const hit = table.map((t) => ({ t, m: t.re.exec(url) })).find((x) => x.m && x.t.method === method)
    if (!hit) return { status: 404, body: { success: false, message: 'no such route in test app' }, headers: {} }
    const params = {}; hit.t.keys.forEach((k, i) => { params[k] = hit.m[i + 1] })
    const req = { method, url, params, query, body, headers: token ? { authorization: `Bearer ${token}` } : {}, __file: file }
    const res = new MockRes()
    let i = 0
    const next = (err) => {
      if (err) return errorHandler(err, req, res, () => {})
      const mw = hit.t.mws[i++]
      if (!mw) return res.status(500).json({ success: false, message: 'chain ended without a response' })
      try {
        const out = mw(req, res, next)
        if (out && typeof out.catch === 'function') out.catch(next)
      } catch (e) { next(e) }
    }
    next()
    await res.done
    return { status: res.statusCode, body: res.body, headers: res.headers, buffer: res.buffer }
  }
  return { request, routes: table }
}
module.exports = { install }
