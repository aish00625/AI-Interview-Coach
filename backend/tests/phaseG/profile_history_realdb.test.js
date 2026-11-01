// Phase G regression tests: the Profile page's backend contract (the page was local-only before), the experience-level
// eligibility check that depends on it, and the data behind the History page. Real route chains + real PostgreSQL.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')
const { makeDocx } = require('../helpers/fixtures')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase G profile/history', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumes-g-'))
  process.env.RESUME_STORAGE_DIR = dir
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => { testPool.closeAll(); fs.rmSync(dir, { recursive: true, force: true }) })
  const { install } = require('../helpers/miniApp')
  const app = install(testPool)
  const api = app.request
  const tag = Date.now(); const S = {}
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.success, true); return r.body.data }
  const reg = async (label, extra = {}) => ok(await api('POST', '/api/auth/register', { body: { name: label, email: `${label}${tag}@g.test`, password: 'password123', ...extra } }), 201)

  test('setup: candidate, approved hirer organization', async () => {
    S.cand = await reg('gcand')
    S.hirer = await reg('ghirer', { role: 'hirer', companyName: `G Org ${tag}` })
    await testPool.query("UPDATE organizations SET status = 'approved' WHERE id = $1", [S.hirer.user.organization.id])
  })

  test('profile: a new candidate has the defaults; GET returns snake_case fields the page reads', async () => {
    const p = ok(await api('GET', '/api/users/profile', { token: S.cand.token }))
    assert.equal(p.experience_level, 'fresher'); assert.equal(p.preferred_language, 'javascript'); assert.deepEqual(p.skills, [])
    for (const k of ['target_role', 'experience_level', 'preferred_language', 'skills']) assert.ok(k in p, k)
  })

  test('profile: PUT persists role, level, language and skills; a later GET (fresh request) returns them', async () => {
    const saved = ok(await api('PUT', '/api/users/profile', { token: S.cand.token, body: { targetRole: 'Backend Developer', experienceLevel: 'experienced', preferredLanguage: 'python', skillNames: ['Java', 'SQL'] } }))
    assert.equal(saved.experience_level, 'experienced')
    const p = ok(await api('GET', '/api/users/profile', { token: S.cand.token }))
    assert.equal(p.target_role, 'Backend Developer'); assert.equal(p.experience_level, 'experienced'); assert.equal(p.preferred_language, 'python')
    assert.deepEqual(p.skills.map((s) => s.name).sort(), ['Java', 'SQL'])
    const row = (await testPool.query('SELECT experience_level FROM profiles WHERE user_id = $1', [S.cand.user.id])).rows[0]
    assert.equal(row.experience_level, 'experienced', 'stored in PostgreSQL, not just echoed')
  })

  test('profile: skills are replaced (not appended); omitted fields keep their stored value', async () => {
    ok(await api('PUT', '/api/users/profile', { token: S.cand.token, body: { skillNames: ['Python'] } }))
    const p = ok(await api('GET', '/api/users/profile', { token: S.cand.token }))
    assert.deepEqual(p.skills.map((s) => s.name), ['Python'])
    assert.equal(p.target_role, 'Backend Developer'); assert.equal(p.experience_level, 'experienced')
  })

  test('profile is private: hirers are refused, anonymous is 401, and the id is never taken from the request', async () => {
    assert.equal((await api('GET', '/api/users/profile', { token: S.hirer.token })).status, 403)
    assert.equal((await api('PUT', '/api/users/profile', { token: S.hirer.token, body: { experienceLevel: 'fresher' } })).status, 403)
    assert.equal((await api('GET', '/api/users/profile')).status, 401)
    const other = await reg('gother')
    ok(await api('PUT', '/api/users/profile', { token: other.token, body: { userId: S.cand.user.id, targetRole: 'Hacker', experienceLevel: 'fresher' } }))
    const mine = ok(await api('GET', '/api/users/profile', { token: S.cand.token }))
    assert.equal(mine.target_role, 'Backend Developer', 'another user cannot overwrite my profile by passing my id')
  })

  test('REGRESSION: an "experienced only" job is refused until the candidate saves experience level on the Profile page', async () => {
    const c = await reg('gelig')
    const job = ok(await api('POST', '/api/hirer/jobs', { token: S.hirer.token, body: { title: 'Senior Dev', description: 'Needs experience', experienceLevel: 'experienced', requiredSkills: ['Java'] } }), 201).job
    ok(await api('POST', `/api/hirer/jobs/${job.id}/status`, { token: S.hirer.token, body: { status: 'open' } }))
    const resumeService = require(path.join(root, 'services/resumeService.js'))
    const resume = await resumeService.uploadResume({ userId: c.user.id, file: { buffer: makeDocx(['Alex', 'Java']), originalname: 'cv.docx' } })
    const first = await api('POST', '/api/applications', { token: c.token, body: { consentShareResume: true, consentShareAssessment: true, jobId: job.id, resumeId: resume.id } })
    assert.equal(first.status, 422); assert.match(first.body.message, /experienced/i)
    ok(await api('PUT', '/api/users/profile', { token: c.token, body: { experienceLevel: 'experienced', skillNames: ['Java'] } }))
    ok(await api('POST', '/api/applications', { token: c.token, body: { consentShareResume: true, consentShareAssessment: true, jobId: job.id, resumeId: resume.id } }), 201)
    // ...and the saved skills now feed the hirer's skill-match (it was always 0% while the page could not save).
    const list = ok(await api('GET', `/api/hirer/jobs/${job.id}/applications`, { token: S.hirer.token }))
    assert.equal(list.applicants[0].skill_match_percent, 100)
  })

  test('history: GET /api/interviews returns exactly the practice sessions of the caller, with the fields the page renders', async () => {
    const mine = ok(await api('POST', '/api/interviews', { token: S.cand.token, body: { interviewType: 'hr', targetRole: 'Practice Role', difficulty: 'easy' } }), 201)
    const sessionId = (mine.session || mine).id
    const other = await reg('ghist')
    ok(await api('POST', '/api/interviews', { token: other.token, body: { interviewType: 'hr', targetRole: 'Someone else', difficulty: 'easy' } }), 201)
    const list = ok(await api('GET', '/api/interviews', { token: S.cand.token }))
    assert.ok(Array.isArray(list)); assert.equal(list.length, 1)
    const s = list[0]
    assert.equal(String(s.id), String(sessionId)); assert.equal(s.target_role, 'Practice Role')
    for (const k of ['id', 'started_at', 'interview_type', 'target_role', 'difficulty', 'final_score', 'status']) assert.ok(k in s, `history page reads ${k}`)
    assert.equal((await api('GET', '/api/interviews', { token: S.hirer.token })).status, 403)
  })
}
