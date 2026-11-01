// Phase D against real PostgreSQL (needs AIC_TEST_DB). The AI evaluator and code executor are stubbed at their client
// modules (their HTTP contracts are unchanged and are not exercised here); everything else is the real code + SQL.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase D real-DB tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  process.env.MAX_ASSESSMENT_ATTEMPTS = '3'
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  let executorCalls = 0
  stubModule(path.join(root, 'services/aiServiceClient'), {
    evaluateAnswer: async () => ({ technicalScore: 80, relevanceScore: 70, clarityScore: 60, completenessScore: 90, strengths: ['a'], weaknesses: ['b'], suggestedImprovement: 's', modelAnswer: 'm' }),
  })
  stubModule(path.join(root, 'services/codeExecutorClient'), {
    executeCode: async ({ sourceCode }) => {
      executorCalls++
      const ok = sourceCode.includes('PASS')
      return { status: 'completed', passedTests: ok ? 2 : 1, totalTests: 2, tests: [], stderr: '', executionTimeMs: 5, memoryUsedKb: null }
    },
  })
  const userModel = require(path.join(root, 'models/userModel.js'))
  const orgModel = require(path.join(root, 'models/organizationModel.js'))
  const jobService = require(path.join(root, 'services/jobService.js'))
  const resumeModel = require(path.join(root, 'models/resumeModel.js'))
  const applicationModel = require(path.join(root, 'models/applicationModel.js'))
  const assessmentService = require(path.join(root, 'services/assessmentService.js'))
  const interviewService = require(path.join(root, 'services/interviewService.js'))
  const codingService = require(path.join(root, 'services/codingService.js'))
  const dashboardModel = require(path.join(root, 'models/dashboardModel.js'))
  const codingModel = require(path.join(root, 'models/codingModel.js'))
  const tag = Date.now()
  const ctx = {}

  async function mkOrg(label) {
    const u = await userModel.createUser({ email: `${label}${tag}@t.com`, passwordHash: 'h', name: label, role: 'hirer' })
    const o = await orgModel.createOrganization({ name: `${label} ${tag}`, createdBy: u.id })
    await orgModel.addMember({ organizationId: o.id, userId: u.id })
    await orgModel.setOrganizationStatus({ id: o.id, status: 'approved', reviewedBy: u.id })
    return { user: u, org: o }
  }
  async function mkApplication(candidate, jobId) {
    const r = await resumeModel.insertResume({ userId: candidate.id, originalFilename: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 10, storageKey: `${tag}-${candidate.id}-${jobId}-${Math.random()}`, extractedText: null, extractionStatus: 'unsupported' })
    const id = await applicationModel.insertApplication({ consentResume: true, consentAssessment: true, jobId, candidateId: candidate.id, resumeId: r.id })
    await applicationModel.addHistory({ applicationId: id, toStatus: 'submitted', changedBy: candidate.id })
    return id
  }

  test('setup', async () => {
    ctx.a = await mkOrg('da'); ctx.b = await mkOrg('db')
    ctx.c1 = await userModel.createUser({ email: `dc1${tag}@t.com`, passwordHash: 'h', name: 'c1' })
    ctx.c2 = await userModel.createUser({ email: `dc2${tag}@t.com`, passwordHash: 'h', name: 'c2' })
    const mk = async (t, d) => (await testPool.query("INSERT INTO coding_problems (title, description, difficulty, test_cases) VALUES ($1, 'd', $2, '[{\"input\":\"1\",\"expected_output\":\"1\"}]') RETURNING id", [`${t}${tag}`, d])).rows[0].id
    ctx.p1 = await mk('P1', 'easy'); ctx.p2 = await mk('P2', 'medium'); ctx.p3 = await mk('P3', 'hard')
    const job = await jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: { title: 'Assess Job', description: 'd', requiredSkills: ['Java'] } })
    ctx.job = await jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: job.id, status: 'open' })
    const plain = await jobService.createJob({ organizationId: ctx.a.org.id, userId: ctx.a.user.id, body: { title: 'No Assess', description: 'd', requiredSkills: ['Java'] } })
    ctx.plainJob = await jobService.changeStatus({ organizationId: ctx.a.org.id, jobId: plain.id, status: 'open' })
    ctx.app1 = await mkApplication(ctx.c1, ctx.job.id)
    ctx.app2 = await mkApplication(ctx.c2, ctx.job.id)
    ctx.appPlain = await mkApplication(ctx.c1, ctx.plainJob.id)
  })

  test('hirer config: org scoping, validation, defaults, replace', async () => {
    const empty = await assessmentService.getJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id })
    assert.equal(empty.interview_enabled, false); assert.deepEqual(empty.problems, []); assert.equal(empty.locked, false)
    await assert.rejects(assessmentService.getJobAssessment({ organizationId: ctx.b.org.id, jobId: ctx.job.id }), { statusCode: 404 })
    await assert.rejects(assessmentService.setJobAssessment({ organizationId: ctx.b.org.id, jobId: ctx.job.id, interviewEnabled: true, problemIds: [] }), { statusCode: 404 })
    await assert.rejects(assessmentService.setJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id, interviewEnabled: true, problemIds: [999999999] }), { statusCode: 400 })
    await assert.rejects(assessmentService.setJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id, interviewEnabled: true, problemIds: [1, 2, 3, 4, 5, 6] }), { statusCode: 400 })
    await assert.rejects(assessmentService.setJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id, interviewEnabled: true, problemIds: ['x'] }), { statusCode: 400 })
    await assert.rejects(assessmentService.setJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id, interviewEnabled: true, interviewType: 'bogus', problemIds: [] }), (e) => e.code === '23514')
    const cfg = await assessmentService.setJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id, interviewEnabled: true, interviewType: 'hr', interviewDifficulty: 'easy', problemIds: [ctx.p1, ctx.p2, ctx.p1] })
    assert.deepEqual(cfg.problems.map((p) => p.id), [ctx.p1, ctx.p2]); assert.equal(cfg.interview_type, 'hr')
    assert.equal((await testPool.query('SELECT count(*)::int n FROM job_assessments WHERE job_id = $1', [ctx.job.id])).rows[0].n, 1, 'failed attempts rolled back, no duplicates')
  })

  test('candidate cannot start/submit for a job without the assessment, or for someone else\'s application', async () => {
    await assert.rejects(assessmentService.startInterviewAssessment({ candidateId: ctx.c1.id, applicationId: ctx.appPlain }), { statusCode: 404 })
    await assert.rejects(assessmentService.startInterviewAssessment({ candidateId: ctx.c2.id, applicationId: ctx.app1 }), { statusCode: 404 })
    await assert.rejects(codingService.createSubmission({ userId: ctx.c2.id, problemId: ctx.p1, applicationId: ctx.app1, language: 'python', sourceCode: 'PASS' }), { statusCode: 404 })
    assert.equal(executorCalls, 0, 'executor never reached on rejected submissions')
  })

  test('interview assessment: tagged with application, private from practice history, resumable, single attempt', async () => {
    const { session, questions, resumed } = await assessmentService.startInterviewAssessment({ candidateId: ctx.c1.id, applicationId: ctx.app1 })
    assert.equal(resumed, false); assert.equal(session.application_id, ctx.app1); assert.equal(session.target_role, 'Assess Job')
    assert.equal(session.interview_type, 'hr'); assert.equal(session.difficulty, 'easy'); assert.ok(questions.length >= 1)
    ctx.session = session; ctx.questions = questions
    const again = await assessmentService.startInterviewAssessment({ candidateId: ctx.c1.id, applicationId: ctx.app1 })
    assert.equal(again.resumed, true); assert.equal(again.session.id, session.id)
    assert.equal((await testPool.query('SELECT count(*)::int n FROM interview_sessions WHERE application_id = $1', [ctx.app1])).rows[0].n, 1)
    assert.equal((await interviewService.getUserInterviews(ctx.c1.id, {})).some((s) => s.id === session.id), false, 'not in practice history')
    // existing evaluator flow still works on an assessment session
    const out = await interviewService.submitAnswer({ sessionId: session.id, userId: ctx.c1.id, questionId: questions[0].id, answerText: 'my answer' })
    assert.equal(Number(out.answer.technical_score), 80)
    const done = await interviewService.completeInterviewSession(session.id, ctx.c1.id)
    assert.equal(done.status, 'completed'); assert.equal(Number(done.final_score), 75)
    await assert.rejects(assessmentService.startInterviewAssessment({ candidateId: ctx.c1.id, applicationId: ctx.app1 }), { statusCode: 409 })
  })

  test('concurrent starts create exactly one session (unique index)', async () => {
    const res = await Promise.allSettled([1, 2, 3].map(() => assessmentService.startInterviewAssessment({ candidateId: ctx.c2.id, applicationId: ctx.app2 })))
    assert.ok(res.some((r) => r.status === 'fulfilled'))
    assert.equal((await testPool.query('SELECT count(*)::int n FROM interview_sessions WHERE application_id = $1', [ctx.app2])).rows[0].n, 1)
  })

  test('coding assessment: problem must belong to the job, attempts capped, results stored with application link', async () => {
    await assert.rejects(codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p3, applicationId: ctx.app1, language: 'python', sourceCode: 'PASS' }), { statusCode: 422 })
    const bad = await codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p1, applicationId: ctx.app1, language: 'python', sourceCode: 'nope' })
    assert.equal(bad.status, 'failed'); assert.equal(bad.application_id, ctx.app1)
    const good = await codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p1, applicationId: ctx.app1, language: 'python', sourceCode: 'PASS' })
    assert.equal(good.status, 'passed')
    await codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p1, applicationId: ctx.app1, language: 'python', sourceCode: 'nope' })
    const before = executorCalls
    await assert.rejects(codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p1, applicationId: ctx.app1, language: 'python', sourceCode: 'PASS' }), { statusCode: 409 })
    assert.equal(executorCalls, before, 'no executor call after cap')
    const progress = await assessmentService.getCandidateProgress({ applicationId: ctx.app1, jobId: ctx.job.id })
    const p1 = progress.coding.find((c) => c.problemId === ctx.p1); const p2 = progress.coding.find((c) => c.problemId === ctx.p2)
    assert.deepEqual([p1.attempts, p1.bestStatus, p1.bestPassed, p1.bestTotal], [3, 'passed', 2, 2])
    assert.deepEqual([p2.attempts, p2.bestStatus], [0, 'not_attempted'])
    assert.equal(progress.interview.status, 'completed'); assert.equal(progress.interview.finalScore, 75)
  })

  test('private practice is unchanged: no applicationId -> practice row, listed in history, any problem allowed', async () => {
    const s = await codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p3, language: 'python', sourceCode: 'PASS' })
    assert.equal(s.application_id, null)
    const mine = await codingService.getUserSubmissions(ctx.c1.id)
    assert.ok(mine.some((x) => x.id === s.id)); assert.equal(mine.some((x) => x.application_id !== null), false)
    assert.equal((await codingModel.getSubmissionsByUser(ctx.c1.id)).length, 1)
    const practice = await interviewService.createInterviewSession({ userId: ctx.c1.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })
    assert.equal(practice.session.application_id, null)
    assert.equal((await interviewService.getUserInterviews(ctx.c1.id, {})).some((x) => x.id === practice.session.id), true)
    ctx.practiceSession = practice.session
  })

  test('practice analytics exclude hiring assessments in EVERY dashboard query', async () => {
    // c1 now has: assessment interview (completed, 75), 3 assessment submissions, 1 practice submission, 1 practice session (in progress)
    const u = ctx.c1.id
    const o = await dashboardModel.getOverviewCounts(u)
    assert.deepEqual([o.totalInterviews, o.completedInterviews, o.averageInterviewScore, o.totalCodingSubmissions, o.passedCodingSubmissions], [1, 0, null, 1, 1])
    assert.deepEqual(await dashboardModel.getScoreOverTime(u), [])
    const act = await dashboardModel.getRecentActivity(u, 50)
    assert.equal(act.length, 2); assert.deepEqual(act.map((a) => a.type).sort(), ['coding', 'interview'])
    const avg = await dashboardModel.getInterviewScoreAverages(u)
    assert.equal(avg.averageTechnicalScore, null)
    assert.deepEqual(await dashboardModel.getInterviewCountsByType(u), [{ type: 'technical', count: 1 }])
    assert.deepEqual(await dashboardModel.getInterviewCountsByDifficulty(u), [{ difficulty: 'easy', count: 1 }])
    assert.deepEqual(await dashboardModel.getSessionStatusBreakdown(u), { completed: 0, in_progress: 1, abandoned: 0 })
    assert.deepEqual(await dashboardModel.getCodingStatusBreakdown(u), { pending: 0, passed: 1, failed: 0, error: 0 })
    assert.deepEqual(await dashboardModel.getCodingByLanguage(u), [{ language: 'python', attempted: 1, solved: 1 }])
    assert.deepEqual(await dashboardModel.getCodingByDifficulty(u), [{ difficulty: 'hard', attempted: 1, solved: 1 }])
    assert.equal((await dashboardModel.getCodingSubmissionsOverTime(u)).reduce((n, d) => n + d.count, 0), 1)
    assert.deepEqual(await dashboardModel.getTopicPerformance(u), [])
  })

  test('assessment config is frozen once any candidate has activity', async () => {
    const cfg = await assessmentService.getJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id })
    assert.equal(cfg.locked, true)
    await assert.rejects(assessmentService.setJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id, interviewEnabled: false, problemIds: [] }), { statusCode: 409 })
    const unchanged = await assessmentService.getJobAssessment({ organizationId: ctx.a.org.id, jobId: ctx.job.id })
    assert.equal(unchanged.interview_enabled, true); assert.equal(unchanged.problems.length, 2)
  })

  test('withdrawn / rejected applications cannot take assessments', async () => {
    await testPool.query("UPDATE applications SET status = 'withdrawn' WHERE id = $1", [ctx.app2])
    await assert.rejects(assessmentService.startInterviewAssessment({ candidateId: ctx.c2.id, applicationId: ctx.app2 }), { statusCode: 409 })
    await assert.rejects(codingService.createSubmission({ userId: ctx.c2.id, problemId: ctx.p1, applicationId: ctx.app2, language: 'python', sourceCode: 'PASS' }), { statusCode: 409 })
    await testPool.query("UPDATE applications SET status = 'rejected' WHERE id = $1", [ctx.app1])
    await assert.rejects(codingService.createSubmission({ userId: ctx.c1.id, problemId: ctx.p2, applicationId: ctx.app1, language: 'python', sourceCode: 'PASS' }), { statusCode: 409 })
    await testPool.query("UPDATE applications SET status = 'submitted' WHERE id = $1", [ctx.app1])
  })

  test('migration 006 rollback keeps candidate data (becomes practice), config tables dropped, re-apply works', async () => {
    const { execFileSync } = require('child_process')
    const psql = (f) => execFileSync('psql', ['-h', process.env.AIC_TEST_HOST || '/tmp', '-p', String(process.env.AIC_TEST_PORT || 55432), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', f], { encoding: 'utf8' })
    const mig = path.join(root, '..', 'database', 'migrations')
    const before = (await testPool.query('SELECT (SELECT count(*) FROM interview_sessions)::int AS i, (SELECT count(*) FROM coding_submissions)::int AS c')).rows[0]
    psql(path.join(mig, '006_job_assessments.down.sql'))
    const after = (await testPool.query('SELECT (SELECT count(*) FROM interview_sessions)::int AS i, (SELECT count(*) FROM coding_submissions)::int AS c')).rows[0]
    assert.deepEqual(after, before, 'no candidate rows deleted by rollback')
    psql(path.join(mig, '006_job_assessments.sql'))
    // After re-apply the old assessment rows are NULL-tagged (became practice) — the documented behaviour
    assert.equal((await testPool.query('SELECT count(*)::int n FROM interview_sessions WHERE application_id IS NOT NULL')).rows[0].n, 0)
  })
}
