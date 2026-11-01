// End-to-end candidate -> hirer workflow, driven through the REAL route chains (guards + controllers + services + SQL)
// against PostgreSQL. NOT exercised: real Express, express-validator rules, multer, bcrypt/JWT libraries, the AI service
// and the code executor (the latter two are stubbed at their client modules; their HTTP contracts are unchanged).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')
const { makeDocx } = require('../helpers/fixtures')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase F e2e workflow', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumes-f-'))
  process.env.RESUME_STORAGE_DIR = dir
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => { testPool.closeAll(); fs.rmSync(dir, { recursive: true, force: true }) })
  stubModule(path.join(root, 'services/aiServiceClient'), {
    evaluateAnswer: async () => ({ technicalScore: 85, relevanceScore: 75, clarityScore: 65, completenessScore: 95, strengths: ['good'], weaknesses: ['brief'], suggestedImprovement: 's', modelAnswer: 'm' }),
  })
  stubModule(path.join(root, 'services/codeExecutorClient'), {
    executeCode: async ({ sourceCode }) => ({ status: 'completed', passedTests: sourceCode.includes('SOLVED') ? 3 : 1, totalTests: 3, tests: [], stderr: '', executionTimeMs: 12, memoryUsedKb: null }),
  })
  const { install } = require('../helpers/miniApp')
  const app = install(testPool)
  const tag = Date.now(); const S = {}
  const api = app.request
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.success, true); return r.body.data }
  const email = (l) => `${l}${tag}@e2e.test`

  test('1. registration: candidate, hirer (pending org), and admin cannot self-register', async () => {
    S.cand = ok(await api('POST', '/api/auth/register', { body: { name: 'Asha Candidate', email: email('asha'), password: 'password123' } }), 201)
    assert.equal(S.cand.user.role, 'candidate'); assert.equal('password_hash' in S.cand.user, false)
    S.hirer = ok(await api('POST', '/api/auth/register', { body: { name: 'Hari Hirer', email: email('hari'), password: 'password123', role: 'hirer', companyName: `Acme ${tag}` } }), 201)
    assert.equal(S.hirer.user.organization.status, 'pending')
    const bad = await api('POST', '/api/auth/register', { body: { name: 'Eve', email: email('eve'), password: 'password123', role: 'admin' } })
    assert.equal(bad.status, 400)
    S.cand2 = ok(await api('POST', '/api/auth/register', { body: { name: 'Bala Candidate', email: email('bala'), password: 'password123' } }), 201)
    S.hirer2 = ok(await api('POST', '/api/auth/register', { body: { name: 'Other Hirer', email: email('other'), password: 'password123', role: 'hirer', companyName: `Rival ${tag}` } }), 201)
  })

  test('2. a PENDING organization is locked out of every hirer endpoint; candidates are locked out too', async () => {
    for (const [m, u] of [['GET', '/api/hirer/jobs'], ['POST', '/api/hirer/jobs'], ['GET', '/api/hirer/dashboard'], ['GET', '/api/hirer/applications/1'], ['GET', '/api/hirer/coding-problems']]) {
      assert.equal((await api(m, u, { token: S.hirer.token })).status, 403, `${m} ${u} (pending org)`)
      assert.equal((await api(m, u, { token: S.cand.token })).status, 403, `${m} ${u} (candidate)`)
      assert.equal((await api(m, u)).status, 401, `${m} ${u} (anonymous)`)
    }
  })

  test('3. admin approval (admin is created the documented way: SQL role update); only an admin can approve', async () => {
    assert.equal((await api('POST', `/api/admin/organizations/${S.hirer.user.organization.id}/approve`, { token: S.hirer.token })).status, 403)
    const adminUser = ok(await api('POST', '/api/auth/register', { body: { name: 'Admin', email: email('admin'), password: 'password123' } }), 201)
    await testPool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminUser.user.id])   // same effect as database/seed/promote_admin.sql
    S.admin = ok(await api('POST', '/api/auth/login', { body: { email: email('admin'), password: 'password123' } }))
    assert.equal(S.admin.user.role, 'admin')
    const list = ok(await api('GET', '/api/admin/organizations', { token: S.admin.token, query: { status: 'pending' } }))
    assert.ok(list.organizations.some((o) => o.id === S.hirer.user.organization.id))
    ok(await api('POST', `/api/admin/organizations/${S.hirer.user.organization.id}/approve`, { token: S.admin.token }))
    ok(await api('POST', `/api/admin/organizations/${S.hirer2.user.organization.id}/approve`, { token: S.admin.token }))
    const me = ok(await api('GET', '/api/auth/me', { token: S.hirer.token }))
    assert.equal(me.user.organization.status, 'approved')
  })

  test('4. hirer creates a job with skills, configures the assessment, publishes', async () => {
    const p = await testPool.query("INSERT INTO coding_problems (title, description, difficulty, test_cases) VALUES ($1, 'Add numbers', 'easy', '[{\"input\":\"1 2\",\"expected_output\":\"3\"}]') RETURNING id", [`Sum ${tag}`])
    S.problem = p.rows[0].id
    const catalog = ok(await api('GET', '/api/hirer/coding-problems', { token: S.hirer.token }))
    assert.ok(catalog.problems.some((x) => x.id === S.problem)); assert.equal(JSON.stringify(catalog).includes('expected_output'), false, 'no test cases in catalogue')
    S.job = ok(await api('POST', '/api/hirer/jobs', { token: S.hirer.token, body: { title: 'Junior Backend Engineer', description: 'Build APIs.', experienceLevel: 'fresher', eligibilityCriteria: 'B.Tech CS', requiredSkills: [`Node${tag}`, `SQL${tag}`] } }), 201).job
    assert.equal(S.job.status, 'draft')
    assert.equal((await api('GET', '/api/jobs', { token: S.cand.token })).body.data.jobs.some((j) => j.id === S.job.id), false, 'drafts invisible to candidates')
    ok(await api('PUT', `/api/hirer/jobs/${S.job.id}/assessment`, { token: S.hirer.token, body: { interviewEnabled: true, interviewType: 'technical', interviewDifficulty: 'easy', problemIds: [S.problem] } }))
    ok(await api('POST', `/api/hirer/jobs/${S.job.id}/status`, { token: S.hirer.token, body: { status: 'open' } }))
  })

  test('5. org isolation over HTTP-shaped routes: the rival hirer sees nothing of this job', async () => {
    assert.equal((await api('GET', `/api/hirer/jobs/${S.job.id}`, { token: S.hirer2.token })).status, 404)
    assert.equal((await api('PATCH', `/api/hirer/jobs/${S.job.id}`, { token: S.hirer2.token, body: { title: 'x' } })).status, 404)
    assert.equal((await api('GET', `/api/hirer/jobs/${S.job.id}/applications`, { token: S.hirer2.token })).status, 404)
    assert.equal((await api('PUT', `/api/hirer/jobs/${S.job.id}/assessment`, { token: S.hirer2.token, body: { interviewEnabled: false, problemIds: [] } })).status, 404)
    assert.deepEqual(ok(await api('GET', '/api/hirer/jobs', { token: S.hirer2.token })).jobs, [])
  })

  test('6. candidate: browse job, set skills/profile, upload resume, apply', async () => {
    const board = ok(await api('GET', '/api/jobs', { token: S.cand.token }))
    assert.ok(board.jobs.some((j) => j.id === S.job.id))
    const detail = ok(await api('GET', `/api/jobs/${S.job.id}`, { token: S.cand.token })).job
    assert.equal('created_by' in detail, false)
    // profile skills via the EXISTING profile endpoint (preserved feature)
    ok(await api('PUT', '/api/users/profile', { token: S.cand.token, body: { targetRole: 'Backend', experienceLevel: 'fresher', preferredLanguage: 'python', skillNames: [`Node${tag}`] } }))
    const noResume = await api('POST', '/api/applications', { token: S.cand.token, body: { consentShareResume: true, consentShareAssessment: true, jobId: S.job.id, resumeId: 999999 } })
    assert.equal(noResume.status, 404)
    const up = ok(await api('POST', '/api/resumes', { token: S.cand.token, file: { buffer: makeDocx(['Asha Candidate', 'Node and SQL projects']), originalname: 'Asha CV.docx' } }), 201).resume
    assert.equal(up.extraction_status, 'ok')
    S.resume = up
    S.app = ok(await api('POST', '/api/applications', { token: S.cand.token, body: { consentShareResume: true, consentShareAssessment: true, jobId: S.job.id, resumeId: S.resume.id, coverNote: 'Keen to join' } }), 201).application
    assert.equal(S.app.status, 'submitted')
    assert.equal((await api('POST', '/api/applications', { token: S.cand.token, body: { consentShareResume: true, consentShareAssessment: true, jobId: S.job.id, resumeId: S.resume.id } })).status, 409)
    // a second candidate cannot use / see the first one's resume or application
    assert.equal((await api('GET', `/api/resumes/${S.resume.id}`, { token: S.cand2.token })).status, 404)
    assert.equal((await api('GET', `/api/resumes/${S.resume.id}/download`, { token: S.cand2.token })).status, 404)
    assert.equal((await api('GET', `/api/applications/${S.app.id}`, { token: S.cand2.token })).status, 404)
  })

  test('7. candidate takes the interview assessment (existing interview endpoints) and the coding assessment', async () => {
    const started = ok(await api('POST', `/api/applications/${S.app.id}/assessment/interview`, { token: S.cand.token }), 201)
    const sid = started.session.id
    assert.equal(started.session.application_id, S.app.id)
    for (const q of started.questions) {
      const r = ok(await api('POST', `/api/interviews/${sid}/answer`, { token: S.cand.token, body: { questionId: q.id, answerText: `My thoughtful answer to ${q.question_text}` } }), 201)
      assert.equal(Number(r.answer.technical_score), 85)
    }
    const done = ok(await api('POST', `/api/interviews/${sid}/complete`, { token: S.cand.token }))
    assert.equal(done.status, 'completed')
    assert.equal((await api('GET', `/api/interviews/${sid}`, { token: S.cand2.token })).status, 404, 'another candidate cannot open this session')
    const sub = ok(await api('POST', '/api/coding/submissions', { token: S.cand.token, body: { problemId: S.problem, language: 'python', sourceCode: 'print(SOLVED)', applicationId: S.app.id } }), 201)
    assert.equal(sub.status, 'passed'); assert.equal(sub.application_id, S.app.id)
    const detail = ok(await api('GET', `/api/applications/${S.app.id}`, { token: S.cand.token })).application
    assert.equal(detail.assessment.interview.status, 'completed'); assert.equal(detail.assessment.coding[0].bestStatus, 'passed')
    // practice stays practice: a plain interview + the applicant-visible dashboards do not include assessment rows
    ok(await api('POST', '/api/interviews', { token: S.cand.token, body: { interviewType: 'hr', targetRole: 'Practice only', difficulty: 'easy' } }), 201)
    const history = ok(await api('GET', '/api/interviews', { token: S.cand.token }))
    assert.equal(history.length, 1); assert.equal(history[0].target_role, 'Practice only')
    const dash = ok(await api('GET', '/api/dashboard', { token: S.cand.token }))
    assert.equal(JSON.stringify(dash).includes('Junior Backend Engineer'), false)
    assert.equal(ok(await api('GET', '/api/coding/submissions', { token: S.cand.token })).length, 0)
  })

  test('8. hirer reviews: list, review detail (resume text + results), download, notes, shortlist, compare, dashboard', async () => {
    const list = ok(await api('GET', `/api/hirer/jobs/${S.job.id}/applications`, { token: S.hirer.token, query: { sort: 'match' } }))
    assert.equal(list.applicants.length, 1); assert.equal(list.applicants[0].skill_match_percent, 50); assert.equal(list.applicants[0].interview_score, 80)
    const rev = ok(await api('GET', `/api/hirer/applications/${S.app.id}`, { token: S.hirer.token }))
    assert.equal(rev.candidate.name, 'Asha Candidate'); assert.equal(rev.resume.text, 'Asha Candidate\nNode and SQL projects')
    assert.equal(rev.coding[0].best.status, 'passed'); assert.equal(rev.interview.finalScore, 80)
    assert.equal(JSON.stringify(rev).includes('Practice only'), false)
    const dl = await api('GET', `/api/hirer/applications/${S.app.id}/resume`, { token: S.hirer.token })
    assert.equal(dl.status, 200); assert.match(dl.headers['content-disposition'], /^attachment; filename="Asha CV.docx"/); assert.equal(dl.headers['x-content-type-options'], 'nosniff')
    assert.equal(dl.buffer.length, S.resume.size_bytes); assert.equal(dl.buffer.subarray(0, 2).toString(), 'PK')
    assert.equal((await api('GET', `/api/hirer/applications/${S.app.id}/resume`, { token: S.hirer2.token })).status, 404)
    ok(await api('POST', `/api/hirer/applications/${S.app.id}/notes`, { token: S.hirer.token, body: { body: 'Great fundamentals' } }), 201)
    ok(await api('POST', `/api/hirer/applications/${S.app.id}/status`, { token: S.hirer.token, body: { status: 'under_review' } }))
    const sl = ok(await api('POST', `/api/hirer/applications/${S.app.id}/status`, { token: S.hirer.token, body: { status: 'shortlisted', note: 'Move to final round' } }))
    assert.equal(sl.application.status, 'shortlisted')
    assert.equal((await api('POST', `/api/hirer/applications/${S.app.id}/status`, { token: S.hirer.token, body: { status: 'submitted' } })).status, 409)
    const dash = ok(await api('GET', '/api/hirer/dashboard', { token: S.hirer.token }))
    assert.equal(dash.applicationsByStatus.shortlisted, 1)
    assert.equal(ok(await api('GET', '/api/hirer/dashboard', { token: S.hirer2.token })).recentApplications.length, 0)
  })

  test('9. second candidate applies; hirer compares and hires one; candidate sees status but never hirer notes', async () => {
    const r2 = ok(await api('POST', '/api/resumes', { token: S.cand2.token, file: { buffer: makeDocx(['Bala']), originalname: 'bala.docx' } }), 201).resume
    const app2 = ok(await api('POST', '/api/applications', { token: S.cand2.token, body: { consentShareResume: true, consentShareAssessment: true, jobId: S.job.id, resumeId: r2.id } }), 201).application
    const cmp = ok(await api('GET', `/api/hirer/jobs/${S.job.id}/compare`, { token: S.hirer.token, query: { ids: `${S.app.id},${app2.id}` } }))
    assert.equal(cmp.candidates.length, 2)
    assert.equal((await api('GET', `/api/hirer/jobs/${S.job.id}/compare`, { token: S.hirer2.token, query: { ids: `${S.app.id},${app2.id}` } })).status, 404)
    ok(await api('POST', `/api/hirer/applications/${S.app.id}/status`, { token: S.hirer.token, body: { status: 'hired' } }))
    ok(await api('POST', `/api/hirer/applications/${app2.id}/status`, { token: S.hirer.token, body: { status: 'rejected', reasonCode: 'skills_mismatch', note: 'Internal: weak fundamentals' } }))
    const mine = ok(await api('GET', `/api/applications/${S.app.id}`, { token: S.cand.token })).application
    assert.equal(mine.status, 'hired')
    const text = JSON.stringify(ok(await api('GET', `/api/applications/${S.app.id}`, { token: S.cand.token })))
    assert.equal(text.includes('Great fundamentals') || text.includes('Move to final round'), false)
    const theirs = JSON.stringify(ok(await api('GET', `/api/applications/${app2.id}`, { token: S.cand2.token })))
    assert.equal(theirs.includes('weak fundamentals'), false)
    assert.equal(ok(await api('GET', '/api/applications', { token: S.cand2.token })).applications[0].status, 'rejected')
    assert.equal((await api('POST', `/api/applications/${S.app.id}/withdraw`, { token: S.cand.token })).status, 409, 'hired application cannot be withdrawn')
  })

  test('10. role isolation: hirer cannot use candidate features; candidate cannot use hirer/admin features', async () => {
    for (const [m, u] of [['GET', '/api/dashboard'], ['GET', '/api/performance'], ['GET', '/api/interviews'], ['GET', '/api/users/profile'], ['GET', '/api/coding/submissions'], ['GET', '/api/jobs'], ['GET', '/api/resumes'], ['GET', '/api/applications']]) {
      assert.equal((await api(m, u, { token: S.hirer.token })).status, 403, `hirer ${m} ${u}`)
    }
    assert.equal((await api('GET', '/api/admin/organizations', { token: S.cand.token })).status, 403)
    assert.equal((await api('GET', '/api/admin/organizations', { token: S.hirer.token })).status, 403)
    assert.equal((await api('GET', '/api/auth/me', { token: 'garbage' })).status, 401)
  })

  test('11. a role change takes effect immediately (JWT role claim is not trusted)', async () => {
    const before = await api('GET', '/api/hirer/dashboard', { token: S.hirer.token })
    assert.equal(before.status, 200)
    await testPool.query("UPDATE users SET role = 'candidate' WHERE id = $1", [S.hirer.user.id])
    assert.equal((await api('GET', '/api/hirer/dashboard', { token: S.hirer.token })).status, 403, 'old token still says hirer, DB says candidate')
    await testPool.query("UPDATE users SET role = 'hirer' WHERE id = $1", [S.hirer.user.id])
    await testPool.query("UPDATE organizations SET status = 'suspended' WHERE id = $1", [S.hirer.user.organization.id])
    assert.equal((await api('GET', '/api/hirer/dashboard', { token: S.hirer.token })).status, 403, 'suspended org loses access immediately')
    assert.equal((await api('GET', `/api/jobs/${S.job.id}`, { token: S.cand.token })).status, 404, 'and its jobs disappear from the board')
    await testPool.query("UPDATE organizations SET status = 'approved' WHERE id = $1", [S.hirer.user.organization.id])
  })
}
