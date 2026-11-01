// Runs the REAL userModel/organizationModel SQL against a real PostgreSQL (needs env AIC_TEST_DB).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('./helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('real-DB model tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  const userModel = require(path.join(root, 'models/userModel.js'))
  const orgModel = require(path.join(root, 'models/organizationModel.js'))
  const tag = Date.now()

  test('userModel.createUser defaults to candidate and findUserById returns role', async () => {
    const c = await userModel.createUser({ email: `c${tag}@t.com`, passwordHash: 'h', name: 'Cand' })
    assert.equal(c.role, 'candidate')
    const h = await userModel.createUser({ email: `h${tag}@t.com`, passwordHash: 'h', name: 'Hirer', role: 'hirer' })
    assert.equal(h.role, 'hirer')
    assert.equal((await userModel.findUserById(h.id)).role, 'hirer')
    assert.equal((await userModel.findUserByEmail(`h${tag}@t.com`)).role, 'hirer')
    assert.equal('password_hash' in (await userModel.findUserById(h.id)), false)
  })

  test('createUser rejects an invalid role (CHECK constraint)', async () => {
    await assert.rejects(userModel.createUser({ email: `x${tag}@t.com`, passwordHash: 'h', name: 'X', role: 'root' }))
  })

  test('organization lifecycle: create pending -> member -> membership -> list -> approve/reject', async () => {
    const h = await userModel.createUser({ email: `o${tag}@t.com`, passwordHash: 'h', name: 'Owner', role: 'hirer' })
    const admin = await userModel.createUser({ email: `adm${tag}@t.com`, passwordHash: 'h', name: 'Admin', role: 'admin' })
    const org = await orgModel.createOrganization({ name: `Org ${tag}`, createdBy: h.id })
    assert.equal(org.status, 'pending')
    await orgModel.addMember({ organizationId: org.id, userId: h.id })
    const m = await orgModel.getMembershipByUserId(h.id)
    assert.deepEqual([m.name, m.status, m.member_role], [`Org ${tag}`, 'pending', 'owner'])
    assert.equal(await orgModel.getMembershipByUserId(admin.id), null)

    const pending = await orgModel.listOrganizations({ status: 'pending' })
    const mine = pending.find((o) => o.name === `Org ${tag}`)
    assert.ok(mine); assert.equal(mine.owner_email, `o${tag}@t.com`)
    assert.ok((await orgModel.listOrganizations()).length >= pending.length, 'null status lists all')

    const ok = await orgModel.setOrganizationStatus({ id: org.id, status: 'approved', reviewedBy: admin.id })
    assert.equal(ok.status, 'approved'); assert.ok(ok.reviewed_at)
    assert.equal((await orgModel.getMembershipByUserId(h.id)).status, 'approved')
    assert.equal(await orgModel.setOrganizationStatus({ id: 99999999, status: 'approved', reviewedBy: admin.id }), null)
    await assert.rejects(orgModel.setOrganizationStatus({ id: org.id, status: 'bogus', reviewedBy: admin.id }))
    assert.equal((await orgModel.listOrganizations({ status: 'pending' })).some((o) => o.id === org.id), false)
  })

  test('a user cannot belong to two organizations (UNIQUE user_id)', async () => {
    const h = await userModel.createUser({ email: `u${tag}@t.com`, passwordHash: 'h', name: 'U', role: 'hirer' })
    const a = await orgModel.createOrganization({ name: `A ${tag}`, createdBy: h.id })
    const b = await orgModel.createOrganization({ name: `B ${tag}`, createdBy: h.id })
    await orgModel.addMember({ organizationId: a.id, userId: h.id })
    await assert.rejects(orgModel.addMember({ organizationId: b.id, userId: h.id }))
  })
}
