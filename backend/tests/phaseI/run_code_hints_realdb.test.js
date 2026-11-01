// Phase I against real PostgreSQL: Run Code (sample tests only, nothing recorded) and tiered hints (progressive,
// withheld during an active job assessment). The executor client is stubbed at the module boundary and records what
// the backend sent, so we can assert hidden tests never leave the server.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase I run/hints', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  const sent = []
  let nextResult = null
  stubModule(path.join(root, 'services/codeExecutorClient'), {
    executeCode: async (req) => { sent.push(req); if (nextResult instanceof Error) throw nextResult; return typeof nextResult === 'function' ? nextResult(req) : nextResult },
  })
  const userModel = require(path.join(root, 'models/userModel.js'))
  const orgModel = require(path.join(root, 'models/organizationModel.js'))
  const jobService = require(path.join(root, 'services/jobService.js'))
  const resumeModel = require(path.join(root, 'models/resumeModel.js'))
  const applicationModel = require(path.join(root, 'models/applicationModel.js'))
  const assessmentService = require(path.join(root, 'services/assessmentService.js'))
  const codingService = require(path.join(root, 'services/codingService.js'))
  const tag = Date.now(); const ctx = {}
  const HIDDEN_IN = 'HIDDEN-INPUT-DO-NOT-LEAK'; const HIDDEN_OUT = 'HIDDEN-ANSWER-DO-NOT-LEAK'
  const cases = [
    { input: '2 3', expected_output: '5', is_hidden: false },
    { input: '10 5', expected_output: '15', is_hidden: false },
    { input: HIDDEN_IN, expected_output: HIDDEN_OUT, is_hidden: true },
  ]
  const countRows = async () => ({
    subs: (await testPool.query('SELECT count(*)::int n FROM coding_submissions WHERE user_id = $1', [ctx.cand.id])).rows[0].n,
  })

  test('setup', async () => {
    ctx.cand = await userModel.createUser({ email: `ri${tag}@t.com`, passwordHash: 'h', name: 'runner' })
    ctx.other = await userModel.createUser({ email: `ro${tag}@t.com`, passwordHash: 'h', name: 'other' })
    ctx.third = await userModel.createUser({ email: `rt${tag}@t.com`, passwordHash: 'h', name: 'third' })
    const mk = async (title, hints, tests) => (await testPool.query(
      "INSERT INTO coding_problems (title, description, difficulty, test_cases, hints) VALUES ($1, 'd', 'easy', $2::jsonb, $3::jsonb) RETURNING id",
      [`${title}${tag}`, JSON.stringify(tests), JSON.stringify(hints)])).rows[0].id
    ctx.pSum = await mk('Sum', ['Think about reading two numbers.', 'Add them.', 'Print the sum.'], cases)
    ctx.pHidden = await mk('OnlyHidden', ['h1'], [cases[2]])
    ctx.pNoHints = await mk('NoHints', [], cases)
    const org = await userModel.createUser({ email: `rh${tag}@t.com`, passwordHash: 'h', name: 'hirer', role: 'hirer' })
    ctx.o = await orgModel.createOrganization({ name: `RO ${tag}`, createdBy: org.id })
    await orgModel.addMember({ organizationId: ctx.o.id, userId: org.id })
    await orgModel.setOrganizationStatus({ id: ctx.o.id, status: 'approved', reviewedBy: org.id })
    ctx.hirer = org
  })

  test('runCode sends ONLY visible tests, flagged returnOutput; hidden test data never reaches the executor or the response', async () => {
    nextResult = { status: 'completed', passedTests: 1, totalTests: 2, executionTimeMs: 40, memoryUsedKb: null, stderr: '',
      tests: [{ index: 1, passed: true, actualOutput: '5', stderr: null, durationMs: 11 }, { index: 2, passed: false, actualOutput: '14', stderr: null, durationMs: 9 }] }
    const before = await countRows()
    const r = await codingService.runCode({ problemId: ctx.pSum, language: 'python', sourceCode: 'print(1)' })
    const req = sent.at(-1)
    assert.equal(req.testCases.length, 2)
    assert.ok(req.testCases.every((t) => t.returnOutput === true))
    assert.ok(!JSON.stringify(req).includes(HIDDEN_IN) && !JSON.stringify(req).includes(HIDDEN_OUT))
    assert.ok(!JSON.stringify(r).includes(HIDDEN_IN) && !JSON.stringify(r).includes(HIDDEN_OUT))
    assert.equal(r.recorded, false); assert.equal(r.passedTests, 1); assert.equal(r.totalTests, 2)
    assert.deepEqual(r.tests[1], { index: 2, passed: false, ran: true, input: '10 5', expectedOutput: '15', actualOutput: '14', durationMs: 9, explanation: r.tests[1].explanation })
    assert.equal(r.tests[1].explanation.category, 'off_by_one')
    assert.equal(r.memoryUsedKb, null, 'memory is not measured and must not be invented')
    assert.match(r.summary.headline, /1 of 2/)
    assert.deepEqual(await countRows(), before, 'nothing recorded')
  })

  test('runCode does not consume job-assessment attempts and works for a problem inside an assessment', async () => {
    const job = await jobService.createJob({ organizationId: ctx.o.id, userId: ctx.hirer.id, body: { title: 'RunJob', description: 'd', requiredSkills: ['Java'] } })
    ctx.job = await jobService.changeStatus({ organizationId: ctx.o.id, jobId: job.id, status: 'open' })
    await assessmentService.setJobAssessment({ organizationId: ctx.o.id, jobId: ctx.job.id, interviewEnabled: false, problemIds: [ctx.pSum] })
    const r = await resumeModel.insertResume({ userId: ctx.cand.id, originalFilename: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 10, storageKey: `k${tag}`, extractedText: null, extractionStatus: 'unsupported' })
    ctx.appId = await applicationModel.insertApplication({ consentResume: true, consentAssessment: true, jobId: ctx.job.id, candidateId: ctx.cand.id, resumeId: r.id })
    await applicationModel.addHistory({ applicationId: ctx.appId, toStatus: 'submitted', changedBy: ctx.cand.id })
    nextResult = { status: 'completed', passedTests: 2, totalTests: 2, executionTimeMs: 5, memoryUsedKb: null, stderr: '', tests: [{ index: 1, passed: true, actualOutput: '5' }, { index: 2, passed: true, actualOutput: '15' }] }
    for (let i = 0; i < 8; i++) await codingService.runCode({ problemId: ctx.pSum, language: 'python', sourceCode: 'print(1)' })
    const progress = await assessmentService.getCandidateProgress({ applicationId: ctx.appId, jobId: ctx.job.id })
    assert.equal(progress.coding[0].attempts, 0, '8 runs used zero of the assessment attempts')
    assert.equal((await testPool.query('SELECT count(*)::int n FROM coding_submissions WHERE application_id = $1', [ctx.appId])).rows[0].n, 0)
  })

  test('runCode: executor down -> 503 (unknown, not "failed"); no sample tests -> 422; unknown problem -> 404; compile error passes stderr', async () => {
    const down = new Error('Code execution service is temporarily unavailable.'); down.statusCode = 503
    nextResult = down
    await assert.rejects(codingService.runCode({ problemId: ctx.pSum, language: 'python', sourceCode: 'x' }), { statusCode: 503 })
    await assert.rejects(codingService.runCode({ problemId: ctx.pHidden, language: 'python', sourceCode: 'x' }), { statusCode: 422 })
    await assert.rejects(codingService.runCode({ problemId: 999999999, language: 'python', sourceCode: 'x' }), { statusCode: 404 })
    nextResult = { status: 'compilation_error', passedTests: 0, totalTests: 2, executionTimeMs: 5, memoryUsedKb: null, stderr: 'Main.java:3: error: missing semicolon', tests: [] }
    const r = await codingService.runCode({ problemId: ctx.pSum, language: 'java', sourceCode: 'x' })
    assert.equal(r.status, 'compilation_error'); assert.match(r.summary.nextStep, /missing semicolon/)
    assert.equal(r.tests.every((t) => t.ran === false), true)
  })

  test('createSubmission still records, and now labels tests visible/hidden without exposing any test data', async () => {
    nextResult = { status: 'completed', passedTests: 2, totalTests: 3, executionTimeMs: 5, memoryUsedKb: null, stderr: '',
      tests: [{ index: 1, passed: true }, { index: 2, passed: true }, { index: 3, passed: false }] }
    const before = await countRows()
    const sub = await codingService.createSubmission({ userId: ctx.cand.id, problemId: ctx.pSum, language: 'python', sourceCode: 'print(1)' })
    assert.equal((await countRows()).subs, before.subs + 1)
    assert.deepEqual(sub.tests.map((t) => t.visible), [true, true, false])
    assert.match(sub.feedback, /1 hidden test/)
    assert.ok(!JSON.stringify(sub).includes(HIDDEN_IN) && !JSON.stringify(sub).includes(HIDDEN_OUT))
    assert.ok(sent.at(-1).testCases.every((t) => t.returnOutput === undefined), 'submissions do not request output echo')
    assert.equal(sub.status, 'failed')
  })

  test('hints: revealed one level at a time, idempotent at the end, per-user, never in problem list/detail', async () => {
    const u = ctx.other; const v = ctx.third
    const none = await codingService.getHints({ userId: u.id, problemId: ctx.pSum })
    assert.deepEqual(none, { total: 3, locked: false, revealed: [] })
    const one = await codingService.revealNextHint({ userId: u.id, problemId: ctx.pSum })
    assert.deepEqual(one.revealed.map((h) => h.level), [1]); assert.equal(one.revealed[0].text, 'Think about reading two numbers.')
    await codingService.revealNextHint({ userId: u.id, problemId: ctx.pSum })
    await codingService.revealNextHint({ userId: u.id, problemId: ctx.pSum })
    const end = await codingService.revealNextHint({ userId: u.id, problemId: ctx.pSum })
    assert.deepEqual(end.revealed.map((h) => h.level), [1, 2, 3], 'extra reveal calls change nothing')
    assert.equal((await codingService.getHints({ userId: v.id, problemId: ctx.pSum })).revealed.length, 0, 'another user sees none of them')
    await assert.rejects(codingService.revealNextHint({ userId: u.id, problemId: ctx.pNoHints }), { statusCode: 404 })
    await assert.rejects(codingService.getHints({ userId: u.id, problemId: 999999999 }), { statusCode: 404 })
    const detail = await codingService.getProblemDetail(ctx.pSum)
    assert.equal(detail.hintCount, 3); assert.ok(!JSON.stringify(detail).includes('Add them.'))
    const list = await codingService.getProblems({})
    assert.ok(!JSON.stringify(list).includes('Think about reading'))
  })

  test('hints are withheld (API-enforced) while the problem is in an active job assessment, and return when the application ends', async () => {
    // ctx.cand has an active application whose assessment includes pSum
    const locked = await codingService.getHints({ userId: ctx.cand.id, problemId: ctx.pSum })
    assert.equal(locked.locked, true); assert.deepEqual(locked.revealed, [])
    await assert.rejects(codingService.revealNextHint({ userId: ctx.cand.id, problemId: ctx.pSum }), { statusCode: 403 })
    // ctx.other revealed all hints in practice BEFORE applying; once they have an active application they are hidden too
    const r = await resumeModel.insertResume({ userId: ctx.other.id, originalFilename: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 10, storageKey: `k2${tag}`, extractedText: null, extractionStatus: 'unsupported' })
    const appId2 = await applicationModel.insertApplication({ consentResume: true, consentAssessment: true, jobId: ctx.job.id, candidateId: ctx.other.id, resumeId: r.id })
    const hidden = await codingService.getHints({ userId: ctx.other.id, problemId: ctx.pSum })
    assert.equal(hidden.locked, true); assert.deepEqual(hidden.revealed, [], 'previously revealed practice hints are not shown during the assessment')
    // a candidate with no application is unaffected
    assert.equal((await codingService.revealNextHint({ userId: ctx.third.id, problemId: ctx.pSum })).locked, false)
    await testPool.query("UPDATE applications SET status = 'withdrawn' WHERE id = ANY($1::bigint[])", [[ctx.appId, appId2]])
    assert.equal((await codingService.getHints({ userId: ctx.cand.id, problemId: ctx.pSum })).locked, false)
    assert.equal((await codingService.getHints({ userId: ctx.other.id, problemId: ctx.pSum })).revealed.length, 3, 'practice hints return once the application is no longer active')
  })
}
