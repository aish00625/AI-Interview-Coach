const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, mockRes, root } = require('./helpers')

// ---- scripted fakes -------------------------------------------------------
const calls = []                       // every SQL statement issued through the fake client
let failOn = null                      // substring of a statement that should throw
const fakeClient = {
  async query(text, params) {
    calls.push({ text: text.replace(/\s+/g, ' ').trim(), params })
    if (failOn && text.includes(failOn)) throw new Error('boom')
    return { rows: [] }
  },
  release() { calls.push({ text: 'RELEASE' }) },
}
stubModule('config/db', { pool: { connect: async () => fakeClient, query: async () => ({ rows: [] }) } })
stubModule('bcryptjs', { hash: async (pw) => `hash(${pw})`, compare: async (pw, h) => h === `hash(${pw})` })
let lastSigned = null
stubModule('jsonwebtoken', { sign: (payload) => { lastSigned = payload; return 'TOKEN' }, verify: () => ({}) })
process.env.JWT_SECRET = 'test-secret'

const userModel = require(path.join(root, 'models/userModel.js'))
const orgModel = require(path.join(root, 'models/organizationModel.js'))
const profileModel = require(path.join(root, 'models/profileModel.js'))

// Replace model functions with recorders (the real SQL is tested separately against PostgreSQL).
const rec = []
userModel.findUserByEmail = async (e) => (e === 'taken@x.com' ? { id: 9, email: e, name: 'T', role: 'candidate', password_hash: 'hash(secret123)' } : null)
userModel.createUser = async (u, client) => { rec.push(['createUser', u.role, !!client]); return { id: 7, email: u.email, name: u.name, role: u.role } }
profileModel.createProfile = async () => { rec.push(['createProfile']) }
orgModel.createOrganization = async (o, client) => { rec.push(['createOrganization', o.name, !!client]); return { id: 3, name: o.name, status: 'pending' } }
orgModel.addMember = async (m, client) => { rec.push(['addMember', m.memberRole, !!client]) }

const authService = require(path.join(root, 'services/authService.js'))
const { requireRole, requireApprovedOrganization } = require(path.join(root, 'middleware/roles.js'))

test.beforeEach(() => { calls.length = 0; rec.length = 0; failOn = null; lastSigned = null })

test('candidate registration: profile created, no organization, role in token, no password_hash', async () => {
  const { token, user } = await authService.registerUser({ name: 'C', email: 'c@x.com', password: 'secret123' })
  assert.equal(token, 'TOKEN')
  assert.deepEqual(rec.map((r) => r[0]), ['createUser', 'createProfile'])
  assert.equal(rec[0][1], 'candidate')
  assert.equal(lastSigned.role, 'candidate')
  assert.equal('organization' in user, false)
  assert.equal(JSON.stringify(user).includes('hash'), false)
  assert.deepEqual(calls.map((c) => c.text), ['BEGIN', 'COMMIT', 'RELEASE'])
})

test('hirer registration: one transaction creating user + pending org + owner; no candidate profile', async () => {
  const { user } = await authService.registerUser({ name: 'H', email: 'h@x.com', password: 'secret123', role: 'hirer', companyName: '  Acme  ' })
  assert.deepEqual(rec.map((r) => r[0]), ['createUser', 'createOrganization', 'addMember'])
  assert.equal(rec[0][1], 'hirer')
  assert.equal(rec[1][1], 'Acme')
  assert.ok(rec.every((r) => r[r.length - 1] === true || r[0] === 'createProfile'), 'all writes use the transaction client')
  assert.equal(user.role, 'hirer')
  assert.equal(user.organization.status, 'pending')
  assert.equal(lastSigned.role, 'hirer')
  assert.deepEqual(calls.map((c) => c.text), ['BEGIN', 'COMMIT', 'RELEASE'])
})

test('registration rejects admin role, missing company, duplicate email; rolls back on failure', async () => {
  await assert.rejects(authService.registerUser({ name: 'A', email: 'a@x.com', password: 'secret123', role: 'admin' }), (e) => e.statusCode === 400)
  await assert.rejects(authService.registerUser({ name: 'H', email: 'h2@x.com', password: 'secret123', role: 'hirer', companyName: '  ' }), (e) => e.statusCode === 400)
  await assert.rejects(authService.registerUser({ name: 'D', email: 'taken@x.com', password: 'secret123' }), (e) => e.statusCode === 409)
  assert.equal(calls.length, 0, 'no DB transaction started for rejected input')

  orgModel.addMember = async () => { throw new Error('boom') }
  await assert.rejects(authService.registerUser({ name: 'H', email: 'h3@x.com', password: 'secret123', role: 'hirer', companyName: 'Z' }))
  assert.deepEqual(calls.map((c) => c.text), ['BEGIN', 'ROLLBACK', 'RELEASE'])
})

test('login: generic error for bad password; hirer login returns organization; token carries role', async () => {
  await assert.rejects(authService.loginUser({ email: 'taken@x.com', password: 'wrong' }), (e) => e.statusCode === 401 && e.message === 'Invalid email or password.')
  await assert.rejects(authService.loginUser({ email: 'nobody@x.com', password: 'x' }), (e) => e.message === 'Invalid email or password.')

  userModel.findUserByEmail = async () => ({ id: 5, email: 'h@x.com', name: 'H', role: 'hirer', password_hash: 'hash(secret123)' })
  orgModel.getMembershipByUserId = async () => ({ id: 3, name: 'Acme', status: 'approved', member_role: 'owner' })
  const { user } = await authService.loginUser({ email: 'h@x.com', password: 'secret123' })
  assert.equal(lastSigned.role, 'hirer')
  assert.deepEqual(user.organization, { id: 3, name: 'Acme', status: 'approved', memberRole: 'owner' })
})

test('getCurrentUser reads role/org from the DB model; 401 if user vanished', async () => {
  userModel.findUserById = async () => ({ id: 5, email: 'h@x.com', name: 'H', role: 'hirer' })
  orgModel.getMembershipByUserId = async () => ({ id: 3, name: 'Acme', status: 'pending', member_role: 'owner' })
  const u = await authService.getCurrentUser(5)
  assert.equal(u.organization.status, 'pending')
  userModel.findUserById = async () => null
  await assert.rejects(authService.getCurrentUser(5), (e) => e.statusCode === 401)
})

test('requireRole trusts the DATABASE role, not the token claim', async () => {
  userModel.findUserById = async () => ({ id: 1, role: 'candidate' })
  let res = mockRes(), nexted = false
  await requireRole('admin')({ user: { userId: 1, role: 'admin' } }, res, () => { nexted = true })   // token lies
  assert.equal(res.statusCode, 403); assert.equal(nexted, false)

  userModel.findUserById = async () => ({ id: 1, role: 'admin' })
  res = mockRes(); const req = { user: { userId: 1 } }
  await requireRole('admin')(req, res, () => { nexted = true })
  assert.equal(nexted, true); assert.equal(req.user.role, 'admin')

  userModel.findUserById = async () => null
  res = mockRes(); await requireRole('admin')({ user: { userId: 1 } }, res, () => {})
  assert.equal(res.statusCode, 401)
})

test('requireRole forwards unexpected errors to next()', async () => {
  userModel.findUserById = async () => { throw new Error('db down') }
  let err; await requireRole('hirer')({ user: { userId: 1 } }, mockRes(), (e) => { err = e })
  assert.equal(err.message, 'db down')
})

test('requireApprovedOrganization: none/pending/rejected/suspended blocked; approved passes with req.organization', async () => {
  for (const status of [null, 'pending', 'rejected', 'suspended']) {
    orgModel.getMembershipByUserId = async () => (status ? { id: 3, status } : null)
    const res = mockRes(); let nexted = false
    await requireApprovedOrganization({ user: { userId: 5 } }, res, () => { nexted = true })
    assert.equal(res.statusCode, 403, String(status)); assert.equal(nexted, false)
  }
  orgModel.getMembershipByUserId = async () => ({ id: 3, status: 'approved' })
  const req = { user: { userId: 5 } }; let nexted = false
  await requireApprovedOrganization(req, mockRes(), () => { nexted = true })
  assert.equal(nexted, true); assert.equal(req.organization.id, 3)
})

test('adminController: approve passes reviewer id from JWT user, 404 for unknown org', async () => {
  const admin = require(path.join(root, 'controllers/adminController.js'))
  let seen
  orgModel.setOrganizationStatus = async (a) => { seen = a; return a.id === 3 ? { id: 3, name: 'Acme', status: a.status } : null }
  let res = mockRes()
  await admin.approveOrganization({ params: { id: '3' }, user: { userId: 99 } }, res, () => {})
  assert.deepEqual(seen, { id: 3, status: 'approved', reviewedBy: 99 }); assert.equal(res.body.data.organization.status, 'approved')
  res = mockRes(); await admin.rejectOrganization({ params: { id: '404' }, user: { userId: 99 } }, res, () => {})
  assert.equal(res.statusCode, 404)
})
