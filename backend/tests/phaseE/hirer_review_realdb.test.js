// Phase E against real PostgreSQL (needs AIC_TEST_DB): hirer review, org isolation (IDOR), privacy, status workflow, compare.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')
const { makeDocx } = require('../helpers/fixtures')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase E real-DB tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumes-e-'))
  process.env.RESUME_STORAGE_DIR = dir
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => { testPool.closeAll(); fs.rmSync(dir, { recursive: true, force: true }) })
  stubModule('config/db', { pool: testPool })
  stubModule(path.join(root, 'services/aiServiceClient'), {
    evaluateAnswer: async () => ({ technicalScore: 80, relevanceScore: 70, clarityScore: 60, completenessScore: 90, strengths: ['clear'], weaknesses: ['short'], suggestedImprovement: 'PRIVATE-COACHING', modelAnswer: 'm',
      evaluationMeta: { confidence: 'low', confidenceNote: 'PRIVATE-NOTE', rubricId: 'r', rubricKind: 'concept', matchedCriteria: ['PRIVATE-MATCH'], missingCriteria: ['PRIVATE-MISSING'],
        answerQuality: { status: 'partial', label: 'x', evaluable: true, reasons: ['PRIVATE-REASON'], wordCount: 9, meaningfulWordCount: 5, wordLikeRatio: 1, scoreBasis: 'PRIVATE-BASIS' } } }),
  })
  stubModule(path.join(root, 'services/codeExecutorClient'), {
    executeCode: async ({ sourceCode }) => ({ status: 'completed', passedTests: sourceCode.includes('PASS') ? 2 : 1, totalTests: 2, tests: [], stderr: '', executionTimeMs: 7, memoryUsedKb: null }),
  })
  const M = (m) => require(path.join(root, m))
  const userModel = M('models/userModel.js'); const orgModel = M('models/organizationModel.js')
  const jobService = M('services/jobService.js'); const resumeService = M('services/resumeService.js')
  const applicationService = M('services/applicationService.js'); const assessmentService = M('services/assessmentService.js')
  const interviewService = M('services/interviewService.js'); const codingService = M('services/codingService.js')
  const interviewModel = M('models/interviewModel.js')
  const hirerService = M('services/hirerApplicationService.js')
  const tag = Date.now(); const ctx = {}

  async function mkOrg(label) {
    const u = await userModel.createUser({ email: `${label}${tag}@t.com`, passwordHash: 'h', name: label, role: 'hirer' })
    const o = await orgModel.createOrganization({ name: `${label} ${tag}`, createdBy: u.id })
    await orgModel.addMember({ organizationId: o.id, userId: u.id })
    await orgModel.setOrganizationStatus({ id: o.id, status: 'approved', reviewedBy: u.id })
    return { user: u, org: o }
  }
  async function mkCandidate(label, skills, level = 'fresher') {
    const u = await userModel.createUser({ email: `${label}${tag}@t.com`, passwordHash: 'h', name: `Cand ${label}` })
    await testPool.query("INSERT INTO profiles (user_id, experience_level, target_role) VALUES ($1, $2, 'Backend') ON CONFLICT (user_id) DO NOTHING", [u.id, level])
    for (const s of skills) {
      const sid = (await testPool.query("INSERT INTO skills (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", [s])).rows[0].id
      await testPool.query('INSERT INTO user_skills (user_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.id, sid])
    }
    const resume = await resumeService.uploadResume({ userId: u.id, file: { buffer: makeDocx([`Resume of ${label}`, 'Skills: stuff']), originalname: `${label}.docx` } })
    return { user: u, resume }
  }
  const org = (x) => x.org.id
  const stream2buf = async (s) => { const c = []; for await (const x of s) c.push(x); return Buffer.concat(c) }

  test('setup: job with 3 skills + assessments, 3 applicants with different strengths', async () => {
    ctx.a = await mkOrg('ea'); ctx.b = await mkOrg('eb')
    const mkP = async (t) => (await testPool.query("INSERT INTO coding_problems (title, description, difficulty, test_cases) VALUES ($1, 'd', 'easy', '[]') RETURNING id", [`${t}${tag}`])).rows[0].id
    ctx.p1 = await mkP('EP1'); ctx.p2 = await mkP('EP2')
    const j = await jobService.createJob({ organizationId: org(ctx.a), userId: ctx.a.user.id, body: { title: 'Review Job', description: 'd', requiredSkills: [`Alpha${tag}`, `Beta${tag}`, `Gamma${tag}`] } })
    ctx.job = await jobService.changeStatus({ organizationId: org(ctx.a), jobId: j.id, status: 'open' })
    await assessmentService.setJobAssessment({ organizationId: org(ctx.a), jobId: ctx.job.id, interviewEnabled: true, interviewType: 'technical', interviewDifficulty: 'easy', problemIds: [ctx.p1, ctx.p2] })
    const j2 = await jobService.createJob({ organizationId: org(ctx.a), userId: ctx.a.user.id, body: { title: 'Other Job', description: 'd', requiredSkills: ['X'] } })
    ctx.job2 = await jobService.changeStatus({ organizationId: org(ctx.a), jobId: j2.id, status: 'open' })
    const jb = await jobService.createJob({ organizationId: org(ctx.b), userId: ctx.b.user.id, body: { title: 'B Job', description: 'd', requiredSkills: ['X'] } })
    ctx.jobB = await jobService.changeStatus({ organizationId: org(ctx.b), jobId: jb.id, status: 'open' })

    ctx.c1 = await mkCandidate('c1', [`Alpha${tag}`, `Beta${tag}`, `Gamma${tag}`])
    ctx.c2 = await mkCandidate('c2', [`Alpha${tag}`])
    ctx.c3 = await mkCandidate('c3', [])
    for (const [k, c] of [['a1', ctx.c1], ['a2', ctx.c2], ['a3', ctx.c3]]) {
      ctx[k] = (await applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: c.user.id, jobId: ctx.job.id, resumeId: c.resume.id, coverNote: `note ${k}` })).id
    }
    ctx.aOther = (await applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.user.id, jobId: ctx.job2.id, resumeId: ctx.c1.resume.id })).id
    ctx.aB = (await applicationService.apply({ consentShareResume: true, consentShareAssessment: true, candidateId: ctx.c1.user.id, jobId: ctx.jobB.id, resumeId: ctx.c1.resume.id })).id
  })

  test('c1 completes assessments; c1 also has PRIVATE practice data that must never reach the hirer', async () => {
    const { session, questions } = await assessmentService.startInterviewAssessment({ candidateId: ctx.c1.user.id, applicationId: ctx.a1 })
    await interviewService.submitAnswer({ sessionId: session.id, userId: ctx.c1.user.id, questionId: questions[0].id, answerText: 'ASSESSMENT-ANSWER' })
    await testPool.query("UPDATE interview_answers SET speech_metrics = '{\"wpm\":999}', cv_metrics = '{\"face_presence_pct\":77}' WHERE question_id = $1", [questions[0].id])
    await interviewService.completeInterviewSession(session.id, ctx.c1.user.id)
    await codingService.createSubmission({ userId: ctx.c1.user.id, problemId: ctx.p1, applicationId: ctx.a1, language: 'python', sourceCode: 'PASS-assessment-code' })
    await codingService.createSubmission({ userId: ctx.c1.user.id, problemId: ctx.p1, applicationId: ctx.a1, language: 'python', sourceCode: 'fail attempt' })
    // private practice
    const prac = await interviewService.createInterviewSession({ userId: ctx.c1.user.id, interviewType: 'technical', targetRole: 'Practice', difficulty: 'easy' })
    await interviewService.submitAnswer({ sessionId: prac.session.id, userId: ctx.c1.user.id, questionId: prac.questions[0].id, answerText: 'PRACTICE-SECRET-ANSWER' })
    await codingService.createSubmission({ userId: ctx.c1.user.id, problemId: ctx.p2, language: 'python', sourceCode: 'PASS PRACTICE-SECRET-CODE' })
  })

  test('applicant list: skill match %, interview/coding summary, sorting, filters, withdrawn last', async () => {
    const { job, applicants } = await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id })
    assert.equal(job.title, 'Review Job'); assert.equal(applicants.length, 3)
    const by = Object.fromEntries(applicants.map((a) => [a.candidate_name, a]))
    assert.deepEqual([by['Cand c1'].skill_match_percent, by['Cand c2'].skill_match_percent, by['Cand c3'].skill_match_percent], [100, 33, 0])
    assert.equal(by['Cand c1'].interview_score, 75); assert.equal(by['Cand c1'].coding_problems_passed, 1); assert.equal(by['Cand c1'].coding_problems_assigned, 2)
    assert.equal(by['Cand c3'].interview_score, null)
    assert.deepEqual((await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id, sort: 'match' })).applicants.map((a) => a.candidate_name), ['Cand c1', 'Cand c2', 'Cand c3'])
    assert.deepEqual((await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id, sort: 'interview' })).applicants[0].candidate_name, 'Cand c1')
    assert.equal((await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id, search: 'c2' })).applicants.length, 1)
    assert.equal((await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id, status: 'shortlisted' })).applicants.length, 0)
    assert.equal((await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id, search: "'; DROP TABLE users; --" })).applicants.length, 0)
    await assert.rejects(hirerService.listApplicants({ organizationId: org(ctx.b), jobId: ctx.job.id }), { statusCode: 404 })
  })

  test('review shows profile, resume text, assessment results; NEVER speech/cv metrics, coaching text, or practice data', async () => {
    const r = await hirerService.getReview({ actorRole: 'owner', organizationId: org(ctx.a), applicationId: ctx.a1 })
    assert.equal(r.restricted, false); assert.equal(r.candidate.email, `c1${tag}@t.com`); assert.equal(r.application.coverNote, 'note a1')
    assert.equal(r.resume.text, 'Resume of c1\nSkills: stuff'); assert.equal(r.resume.extractionStatus, 'ok')
    assert.equal(r.candidate.requiredSkills.length, 3); assert.ok(r.candidate.requiredSkills.every((s) => s.matched))
    assert.equal(r.interview.finalScore, 75); assert.equal(r.interview.questions[0].answer, 'ASSESSMENT-ANSWER')
    assert.deepEqual(r.interview.questions[0].scores, { technical: 80, relevance: 70, clarity: 60, completeness: 90 })
    const p1 = r.coding.find((c) => c.problemId === ctx.p1)
    assert.equal(p1.attemptCount, 2); assert.equal(p1.best.status, 'passed'); assert.equal(p1.best.sourceCode, 'PASS-assessment-code')
    assert.equal(r.coding.find((c) => c.problemId === ctx.p2).best, null)
    assert.deepEqual(r.interview.questions[0].quality, { status: 'partial', label: 'Partially complete', evaluable: true, skipped: false, lowConfidence: true, attempts: 1 })
    const text = JSON.stringify(r)
    for (const forbidden of ['PRIVATE-NOTE', 'PRIVATE-MATCH', 'PRIVATE-MISSING', 'PRIVATE-REASON', 'PRIVATE-BASIS', 'PRACTICE-SECRET', 'wpm', '999', 'face_presence', 'speech_metrics', 'cv_metrics', 'PRIVATE-COACHING', 'password', 'storage_key']) {
      assert.equal(text.includes(forbidden), false, `leaked: ${forbidden}`)
    }
    assert.deepEqual(r.allowedTransitions, ['under_review', 'shortlisted', 'rejected'])
    assert.deepEqual(r.history.map((h) => [h.to_status, h.actor]), [['submitted', 'candidate']])
  })

  test('IDOR: org B cannot review, change, annotate, download or compare org A applications (all 404)', async () => {
    const b = org(ctx.b)
    await assert.rejects(hirerService.getReview({ actorRole: 'owner', organizationId: b, applicationId: ctx.a1 }), { statusCode: 404 })
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: b, applicationId: ctx.a1, userId: ctx.b.user.id, status: 'rejected', reasonCode: 'skills_mismatch' }), { statusCode: 404 })
    await assert.rejects(hirerService.addNote({ organizationId: b, applicationId: ctx.a1, userId: ctx.b.user.id, body: 'x' }), { statusCode: 404 })
    await assert.rejects(hirerService.openResume({ organizationId: b, applicationId: ctx.a1 }), { statusCode: 404 })
    await assert.rejects(hirerService.compare({ organizationId: b, jobId: ctx.job.id, ids: [ctx.a1, ctx.a2] }), { statusCode: 404 })
    // org A cannot reach org B's application either, and an application of another job of A is not comparable under this job
    await assert.rejects(hirerService.getReview({ actorRole: 'owner', organizationId: org(ctx.a), applicationId: ctx.aB }), { statusCode: 404 })
    await assert.rejects(hirerService.compare({ organizationId: org(ctx.a), jobId: ctx.job.id, ids: [ctx.a1, ctx.aOther] }), { statusCode: 404 })
    await assert.rejects(hirerService.getReview({ actorRole: 'owner', organizationId: org(ctx.a), applicationId: 999999999 }), { statusCode: 404 })
    const state = (await testPool.query('SELECT status FROM applications WHERE id = $1', [ctx.a1])).rows[0].status
    assert.equal(state, 'submitted', 'cross-org change attempt had no effect')
  })

  test('resume download streams the exact stored file for the owning org only', async () => {
    const f = await hirerService.openResume({ organizationId: org(ctx.a), applicationId: ctx.a1 })
    const buf = await stream2buf(f.stream)
    assert.equal(buf.length, f.size); assert.equal(buf.subarray(0, 2).toString(), 'PK'); assert.equal(f.filename, 'c1.docx')
    assert.match(f.contentType, /wordprocessingml/)
  })

  test('status workflow: allowed transitions, history with actor + note, invalid and duplicate moves rejected', async () => {
    const o = org(ctx.a); const u = ctx.a.user.id
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'hired' }), { statusCode: 409 })
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'withdrawn' }), { statusCode: 409 })
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'submitted' }), { statusCode: 409 })
    const r1 = await hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'under_review' })
    assert.equal(r1.application.status, 'under_review')
    const r2 = await hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'shortlisted', note: ' strong profile ' })
    assert.deepEqual(r2.history.map((h) => [h.from_status, h.to_status, h.actor, h.note]), [[null, 'submitted', 'candidate', null], ['submitted', 'under_review', 'hiring_team', null], ['under_review', 'shortlisted', 'hiring_team', 'strong profile']])
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'shortlisted' }), { statusCode: 409 })
    const rej = await hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a3, userId: u, status: 'rejected', reasonCode: 'skills_mismatch' })
    assert.deepEqual(rej.allowedTransitions, ['under_review'])
    const re = await hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a3, userId: u, status: 'under_review' })
    assert.equal(re.application.status, 'under_review')
    const hired = await hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'hired' })
    assert.deepEqual(hired.allowedTransitions, [])
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: o, applicationId: ctx.a1, userId: u, status: 'rejected', reasonCode: 'skills_mismatch' }), { statusCode: 409 })
  })

  test('concurrent identical status changes: exactly one succeeds and exactly one history row is written', async () => {
    const before = (await testPool.query('SELECT count(*)::int n FROM application_status_history WHERE application_id = $1', [ctx.a2])).rows[0].n
    const res = await Promise.allSettled([1, 2, 3].map(() => hirerService.changeStatus({ actorRole: 'owner', organizationId: org(ctx.a), applicationId: ctx.a2, userId: ctx.a.user.id, status: 'shortlisted' })))
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1)
    const after = (await testPool.query('SELECT count(*)::int n FROM application_status_history WHERE application_id = $1', [ctx.a2])).rows[0].n
    assert.equal(after - before, 1)
  })

  test('notes are private to the hiring org and never shown to the candidate', async () => {
    const notes = await hirerService.addNote({ organizationId: org(ctx.a), applicationId: ctx.a1, userId: ctx.a.user.id, body: '  HIRER-ONLY-NOTE  ' })
    assert.equal(notes.at(-1).body, 'HIRER-ONLY-NOTE'); assert.equal(notes.at(-1).author_name, 'ea')
    const mine = await applicationService.getMine({ candidateId: ctx.c1.user.id, applicationId: ctx.a1 })
    const text = JSON.stringify(mine)
    assert.equal(text.includes('HIRER-ONLY-NOTE'), false)
    assert.equal(text.includes('strong profile'), false, 'status-change notes are internal too')
    assert.ok(mine.history.some((h) => h.to_status === 'shortlisted'), 'but the status progression itself is visible')
  })

  test('compare: 2-5 candidates of one job, with skill gaps and score averages; bounds and withdrawn enforced', async () => {
    const o = org(ctx.a)
    const c = await hirerService.compare({ organizationId: o, jobId: ctx.job.id, ids: [ctx.a1, ctx.a2, ctx.a3] })
    const by = Object.fromEntries(c.candidates.map((x) => [x.id, x]))
    assert.equal(by[ctx.a1].skill_match_percent, 100); assert.deepEqual(by[ctx.a1].missing_skills, [])
    assert.deepEqual(by[ctx.a2].matched_skills, [`Alpha${tag}`]); assert.equal(by[ctx.a2].missing_skills.length, 2)
    assert.equal(by[ctx.a1].avg_technical, 80); assert.equal(by[ctx.a1].avg_clarity, 60); assert.equal(by[ctx.a2].avg_technical, null)
    assert.equal(by[ctx.a1].coding_problems_passed, 1)
    assert.deepEqual([by[ctx.a1].answers_total, by[ctx.a1].answers_not_evaluable, by[ctx.a1].answers_low_confidence], [1, 0, 1])
    assert.ok([null, 0].includes(by[ctx.a2].answers_total), 'a candidate with no answers (or no consent) has nothing counted')
    await assert.rejects(hirerService.compare({ organizationId: o, jobId: ctx.job.id, ids: [ctx.a1] }), { statusCode: 400 })
    await assert.rejects(hirerService.compare({ organizationId: o, jobId: ctx.job.id, ids: [1, 2, 3, 4, 5, 6] }), { statusCode: 400 })
    await assert.rejects(hirerService.compare({ organizationId: o, jobId: ctx.job.id, ids: [ctx.a1, ctx.a1] }), { statusCode: 400 }, 'duplicates collapse below the minimum')
    await assert.rejects(hirerService.compare({ organizationId: o, jobId: ctx.job.id, ids: ['abc', ctx.a1] }), { statusCode: 400 })
  })

  test('withdrawn application: hirer keeps only status + history; no resume, contact, answers or notes; cannot download or compare', async () => {
    await applicationService.withdraw({ candidateId: ctx.c2.user.id, applicationId: ctx.a2 })
    const r = await hirerService.getReview({ actorRole: 'owner', organizationId: org(ctx.a), applicationId: ctx.a2 })
    assert.equal(r.restricted, true); assert.equal(r.application.status, 'withdrawn')
    const text = JSON.stringify(r)
    assert.equal(text.includes(`c2${tag}@t.com`), false); assert.equal('resume' in r, false); assert.equal('candidate' in r, false); assert.equal('interview' in r, false)
    await assert.rejects(hirerService.openResume({ organizationId: org(ctx.a), applicationId: ctx.a2 }), { statusCode: 403 })
    await assert.rejects(hirerService.addNote({ organizationId: org(ctx.a), applicationId: ctx.a2, userId: ctx.a.user.id, body: 'x' }), { statusCode: 409 })
    await assert.rejects(hirerService.compare({ organizationId: org(ctx.a), jobId: ctx.job.id, ids: [ctx.a1, ctx.a2] }), { statusCode: 409 })
    await assert.rejects(hirerService.changeStatus({ actorRole: 'owner', organizationId: org(ctx.a), applicationId: ctx.a2, userId: ctx.a.user.id, status: 'shortlisted' }), { statusCode: 409 })
    const list = (await hirerService.listApplicants({ organizationId: org(ctx.a), jobId: ctx.job.id })).applicants
    assert.equal(list.at(-1).status, 'withdrawn', 'withdrawn sorted last')
  })

  test('hirer dashboard: org-scoped counts', async () => {
    const d = await hirerService.getDashboard({ organizationId: org(ctx.a) })
    assert.equal(d.jobsByStatus.open, 2)
    assert.equal(d.applicationsByStatus.hired, 1); assert.equal(d.applicationsByStatus.withdrawn, 1)
    const j = d.jobs.find((x) => x.id === ctx.job.id)
    assert.deepEqual([j.applicants, j.shortlisted], [2, 0])
    assert.equal(d.recentApplications.every((x) => x.status !== 'withdrawn'), true)
    const other = await hirerService.getDashboard({ organizationId: org(ctx.b) })
    assert.equal(other.jobs.length, 1); assert.equal(other.recentApplications.length, 1)
    assert.equal(JSON.stringify(d).includes(`B Job`), false, 'no other-org data')
  })
}
