// Phase N, REAL PostgreSQL + REAL route chains: administrator overview / service health, and the hirer dashboard additions.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { setup } = require('../phaseJ/harness')
const { root } = require('../phaseA/helpers')

if (!process.env.AIC_TEST_DB) { test('Phase N admin/hirer stats DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('na')
  const { api, ok, pool, register, hiringFixture, candidateApplies, tag } = H
  const ai = require(path.join(root, 'services/aiServiceClient'))
  const executor = require(path.join(root, 'services/codeExecutorClient'))

  async function makeAdmin(label) {
    const a = await register(label)
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [a.user.id])
    return a
  }

  test('admin routes: only administrators; everyone else 401/403', async () => {
    const cand = await register('plainc'); const hirer = await register('plainh', { role: 'hirer', companyName: `O ${tag}` })
    for (const url of ['/api/admin/overview', '/api/admin/service-health']) {
      assert.equal((await api('GET', url)).status, 401, url)
      assert.equal((await api('GET', url, { token: cand.token })).status, 403, url)
      assert.equal((await api('GET', url, { token: hirer.token })).status, 403, url)
    }
  })

  test('admin overview: database-backed aggregate counts that agree with the tables, and no personal data', async () => {
    const admin = await makeAdmin('adm1')
    const c = await register('signup1', { name: 'Zed Unique Person' })
    const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n
    const o = ok(await api('GET', '/api/admin/overview', { token: admin.token }))
    assert.equal(Object.values(o.usersByRole).reduce((a, b) => a + b, 0), before)
    assert.ok(o.usersByRole.admin >= 1 && o.usersByRole.candidate >= 1)
    const orgRows = (await pool.query('SELECT status, count(*)::int AS n FROM organizations GROUP BY status')).rows
    assert.deepEqual(o.organizationsByStatus, Object.fromEntries(orgRows.map((r) => [r.status, r.n])))
    assert.equal(o.signupsByWeek.length, 8); assert.equal(o.applicationsByWeek.length, 8)
    assert.ok(o.signupsByWeek.at(-1).n >= 2, 'this week should include the users just created')
    assert.ok(o.signupsByWeek.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.week) && Number.isInteger(w.n)))
    assert.ok(o.practiceLast30Days.activeCandidates >= 0 && Number.isInteger(o.practiceLast30Days.codeSubmissions))
    const raw = JSON.stringify(o)
    for (const leak of ['Zed Unique Person', c.user.email, 'password', 'hash(', 'token']) assert.ok(!raw.includes(leak), `overview leaked ${leak}`)
  })

  test('service health: reports each dependency honestly (up, down, or not configured) and never throws', async () => {
    const admin = await makeAdmin('adm2')
    ai.getCapabilities = async () => ({ reachable: true, speech: { state: 'ready' }, vision: { state: 'face_presence_only' } })
    executor.getHealth = async () => ({ configured: true, reachable: false })
    let h = ok(await api('GET', '/api/admin/service-health', { token: admin.token }))
    assert.equal(h.database.ok, true); assert.match(h.database.latestMigration, /^0\d\d_/)
    assert.equal(h.aiService.speech.state, 'ready'); assert.equal(h.codeExecutor.reachable, false)
    assert.match(h.codeExecutor.note, /Docker/)
    ai.getCapabilities = async () => { throw new Error('boom') }; executor.getHealth = undefined       // client crashes / missing
    h = ok(await api('GET', '/api/admin/service-health', { token: admin.token }))
    assert.equal(h.aiService.reachable, false); assert.equal(h.codeExecutor.reachable, false)
  })

  test('hirer dashboard: pipeline counts, weekly trend and first-review time are scoped to the caller\'s organization', async () => {
    const A = await hiringFixture(); const B = await hiringFixture()
    const c1 = await candidateApplies(A.job, 'ha1'); const c2 = await candidateApplies(A.job, 'ha2')
    await candidateApplies(B.job, 'hb1')
    let d = ok(await api('GET', '/api/hirer/dashboard', { token: A.owner.token }))
    assert.equal(d.applicationsByWeek.length, 8); assert.equal(d.applicationsByWeek.at(-1).n, 2)
    assert.equal(d.firstReview.averageDays, null); assert.equal(d.firstReview.reviewedApplications, 0)
    ok(await api('POST', `/api/hirer/applications/${c1.app.id}/status`, { token: A.owner.token, body: { status: 'under_review' } }))
    ok(await api('POST', `/api/hirer/applications/${c2.app.id}/status`, { token: A.owner.token, body: { status: 'under_review' } }))
    ok(await api('POST', `/api/hirer/applications/${c2.app.id}/status`, { token: A.owner.token, body: { status: 'shortlisted' } }))
    d = ok(await api('GET', '/api/hirer/dashboard', { token: A.owner.token }))
    const job = d.jobs.find((j) => j.id === A.job.id)
    assert.deepEqual([job.applicants, job.under_review, job.shortlisted, job.hired, job.awaiting_review], [2, 1, 1, 0, 0])
    assert.equal(d.firstReview.reviewedApplications, 2); assert.ok(typeof d.firstReview.averageDays === 'number' && d.firstReview.averageDays >= 0)
    assert.equal(d.applicationsByStatus.under_review, 1); assert.equal(d.applicationsByStatus.shortlisted, 1)
    const other = ok(await api('GET', '/api/hirer/dashboard', { token: B.owner.token }))
    assert.equal(other.applicationsByWeek.at(-1).n, 1)                                  // only organization B's single application
    assert.equal(other.firstReview.reviewedApplications, 0)
    assert.ok(other.jobs.every((j) => j.id !== A.job.id))
    // established fields are unchanged
    assert.ok(Array.isArray(d.recentApplications) && d.jobsByStatus.open >= 1)
  })
}
