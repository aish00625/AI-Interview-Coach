// Test helpers (Phase A). Stubs third-party/native modules so the real
// project code can be loaded and exercised WITHOUT npm install.
// Real `express`, `pg`, `bcryptjs` and `jsonwebtoken` are NOT exercised here.
const Module = require('module')
const path = require('path')

const stubs = new Map()
const MISSING = Symbol('module-not-installed')
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) {
    const v = stubs.get(request)
    if (v === MISSING) { const e = new Error(`Cannot find module '${request}'`); e.code = 'MODULE_NOT_FOUND'; throw e }
    return v
  }
  if (parent && request.startsWith('.')) {
    const resolved = path.resolve(path.dirname(parent.filename), request)
    for (const [key, val] of stubs) {
      if (path.isAbsolute(key) && (resolved === key || resolved === key.replace(/\.js$/, ''))) return val
    }
  }
  return origLoad.apply(this, arguments)
}

const root = path.resolve(__dirname, '../..')
function stubModule(nameOrRel, impl) {
  stubs.set(nameOrRel.startsWith('.') || nameOrRel.includes('/') && !nameOrRel.startsWith('@') && nameOrRel.startsWith('config') ? path.join(root, nameOrRel) : nameOrRel, impl)
}
/** Makes require(name) fail exactly like an uninstalled package, regardless of what is installed on this machine. */
function stubMissing(name) { stubs.set(name, MISSING) }
function clearStub(key) { stubs.delete(key) }

function mockRes() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
}

module.exports = { stubModule, stubMissing, clearStub, mockRes, root }
