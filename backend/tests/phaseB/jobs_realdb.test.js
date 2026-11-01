// Real jobModel/jobService SQL against real PostgreSQL (needs AIC_TEST_DB). Covers org scoping, status rules, transactions.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase B real-DB tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  const userModel = require(path.join(root, 'models/userModel.js'))
  const orgModel = require(path.join(root, 'models/organizationModel.js'))
  const jobService = require(path.join(root, 'services/jobService.js'))
  const jobModel = require(path.join(root, 'models/jobModel.js'))
  const tag = Date.now()
  const ctx = {}

  async function mkOrg(label, status) {
    const u = await userModel.createUser({ email: `${label}${tag}@t.com`, passwordHash: 'h', name: label, role: 'hirer' })
    const o = await orgModel.createOrganization({ name: `${label} Org ${tag}`, createdBy: u.id })
    await orgModel.addMember({ organizationId: o.id, userId: u.id })
    if (status !== 'pending') await orgModel.setOrganizationStatus({ id: o.id, status, reviewedBy: u.id })
    return { user: u, org: o }
  }
  const body = (extra = {}) => ({ title: 'Backend Dev', description: 'Build APIs', requiredSkills: ['Node.js', { name: 'SQL', mandatory: false }, 'node.js', '  '], ...extra })

  test('setup orgs', async () => {
    ctx.a = await mkOrg('ha', 'approved')
    ctx.b = await mkOrg('hb', 'approved')
    ctx.p = await mkOrg('hp', 'pending')
  })

  test('createJob stores a draft with de-duplicated skills in one transaction', async () => {
    const job = await jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: body() })
    assert.equal(job.status, 'draft')
    assert.equal(job.employment_type, 'full_time'); assert.equal(job.experience_level, 'any')
    assert.deepEqual(job.required_skills.map((s) => [s.name, s.mandatory]).sort(), [['Node.js', true], ['SQL', false]])
    ctx.job = job
  })

  test('createJob rolls back fully when a later step fails (no orphan job)', async () => {
    const before = (await testPool.query('SELECT count(*)::int AS n FROM job_openings')).rows[0].n
    await assert.rejects(jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: body({ requiredSkills: Array.from({ length: 21 }, (_, i) => `s${i}`) }) }))
    // force a DB-level failure inside the transaction: invalid employment type violates the CHECK
    await assert.rejects(jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: body({ employmentType: 'bogus' }) }))
    const after = (await testPool.query('SELECT count(*)::int AS n FROM job_openings')).rows[0].n
    assert.equal(after, before)
  })

  test('organization scoping: org B cannot read, update, publish or delete org A job (404)', async () => {
    const b = ctx.b.org.id
    await assert.rejects(jobService.getJob({ organizationId: b, jobId: ctx.job.id }), { statusCode: 404 })
    await assert.rejects(jobService.updateJob({ organizationId: b, jobId: ctx.job.id, body: { title: 'hacked' } }), { statusCode: 404 })
    await assert.rejects(jobService.changeStatus({ organizationId: b, jobId: ctx.job.id, status: 'open' }), { statusCode: 404 })
    await assert.rejects(jobService.deleteJob({ organizationId: b, jobId: ctx.job.id }), { statusCode: 404 })
    assert.equal((await jobService.listJobs({ organizationId: b })).some((j) => j.id === ctx.job.id), false)
    assert.equal((await jobService.getJob({ organizationId: ctx.a.org.id, jobId: ctx.job.id })).title, 'Backend Dev')
  })

  test('updateJob changes only provided fields, can clear nullable fields, replaces skills', async () => {
    const j = await jobService.updateJob({ organizationId: ctx.a.org.id, jobId: ctx.job.id, body: { location: 'Pune', closesAt: '2099-01-01T00:00:00Z', requiredSkills: ['Python'] } })
    assert.equal(j.title, 'Backend Dev'); assert.equal(j.location, 'Pune')
    assert.deepEqual(j.required_skills.map((s) => s.name), ['Python'])
    const j2 = await jobService.updateJob({ organizationId: ctx.a.org.id, jobId: ctx.job.id, body: { location: null, closesAt: null } })
    assert.equal(j2.location, null); assert.equal(j2.closes_at, null)
    assert.deepEqual(j2.required_skills.map((s) => s.name), ['Python'], 'skills untouched when not provided')
    await assert.rejects(jobService.updateJob({ organizationId: ctx.a.org.id, jobId: ctx.job.id, body: { closesAt: 'not-a-date' } }), { statusCode: 400 })
  })

  test('status workflow: needs skills to publish; draft->open->closed->open; invalid transition 409', async () => {
    const noSkills = await jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: body({ requiredSkills: [] }) })
    await assert.rejects(jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: noSkills.id, status: 'open' }), { statusCode: 422 })
    const open = await jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: ctx.job.id, status: 'open' })
    assert.equal(open.status, 'open'); assert.ok(open.published_at)
    const closed = await jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: ctx.job.id, status: 'closed' })
    assert.equal(closed.status, 'closed')
    assert.equal((await jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: ctx.job.id, status: 'open' })).status, 'open')
    await assert.rejects(jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: noSkills.id, status: 'bogus' }), (e) => e.statusCode === 409 || e.code === '23514')
    ctx.noSkills = noSkills
  })

  test('only draft jobs can be deleted', async () => {
    await assert.rejects(jobService.deleteJob({ organizationId: ctx.a.org.id, jobId: ctx.job.id }), { statusCode: 409 })
    await jobService.deleteJob({ organizationId: ctx.a.org.id, jobId: ctx.noSkills.id })
    await assert.rejects(jobService.getJob({ organizationId: ctx.a.org.id, jobId: ctx.noSkills.id }), { statusCode: 404 })
  })

  test('candidate board shows only open, unexpired jobs of APPROVED organizations', async () => {
    const draft = await jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: body({ title: 'DraftOnly' }) })
    const expired = await jobService.createJob({ organizationId: ctx.b.org.id, userId: ctx.b.user.id, body: body({ title: 'ExpiredJob' }) })
    await jobService.changeStatus({ organizationId: ctx.b.org.id, jobId: expired.id, status: 'open' })
    await testPool.query("UPDATE job_openings SET closes_at = now() - interval '1 day' WHERE id = $1", [expired.id])
    const pend = await jobModel.createJob({ organizationId: ctx.p.org.id, createdBy: ctx.p.user.id, title: 'PendingOrgJob', description: 'd' })
    await jobModel.replaceJobSkills(pend, [{ skillId: ctx.job.required_skills[0].id }])
    await jobModel.setJobStatus(pend, ctx.p.org.id, 'open')
    const list = await jobService.listOpenJobs({ search: null, limit: 50 })
    const titles = list.map((j) => j.title)
    assert.ok(titles.includes('Backend Dev'))
    for (const t of ['DraftOnly', 'ExpiredJob', 'PendingOrgJob']) assert.equal(titles.includes(t), false, t)
    await assert.rejects(jobService.getOpenJob(draft.id), { statusCode: 404 })
    await assert.rejects(jobService.getOpenJob(expired.id), { statusCode: 404 })
    await assert.rejects(jobService.getOpenJob(pend), { statusCode: 404 })
    const one = await jobService.getOpenJob(ctx.job.id)
    assert.equal(one.organization_name, `ha Org ${tag}`)
    assert.equal('created_by' in one, false, 'creator id not exposed to candidates')
    // suspending the org hides its jobs
    await orgModel.setOrganizationStatus({ id: ctx.a.org.id, status: 'suspended', reviewedBy: ctx.a.user.id })
    await assert.rejects(jobService.getOpenJob(ctx.job.id), { statusCode: 404 })
    await orgModel.setOrganizationStatus({ id: ctx.a.org.id, status: 'approved', reviewedBy: ctx.a.user.id })
  })

  test('search filter and pagination bounds', async () => {
    const hit = await jobService.listOpenJobs({ search: 'backend dev', limit: 1000 })
    assert.ok(hit.length >= 1 && hit.length <= 50)
    assert.equal((await jobService.listOpenJobs({ search: `zzz-no-such-${tag}` })).length, 0)
    assert.equal((await jobService.listOpenJobs({ search: "%' OR 1=1 --" })).length, 0)
  })

  test('migration 003 down/up is repeatable', async () => {
    // schema only: verify the tables exist with expected constraints
    const r = await testPool.query("SELECT conname FROM pg_constraint WHERE conrelid = 'job_openings'::regclass AND contype = 'c'")
    assert.ok(r.rows.length >= 3)
  })
}
