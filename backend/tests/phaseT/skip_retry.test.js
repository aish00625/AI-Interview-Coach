// Skip a question, go back and answer again. Real interviewService + interviewModel SQL against real PostgreSQL (needs AIC_TEST_DB).
// Only the AI service client is replaced (no network). Covers: skip = 0 and "Skipped", retry replaces and keeps history, completed interviews
// are locked, other users cannot touch the session, STAR coaching of a replaced answer is cleared, final score counts a skip as 0.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('skip/retry real-DB tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  let nextScore = 80
  stubModule(path.join(root, 'services/aiServiceClient.js'), {
    evaluateAnswer: async ({ answerText }) => ({
      technicalScore: nextScore, relevanceScore: nextScore, clarityScore: nextScore, completenessScore: nextScore,
      strengths: ['s'], weaknesses: ['w'], suggestedImprovement: 'i', modelAnswer: 'm',
      evaluationMeta: { confidence: 'medium', answerQuality: { status: 'good', label: 'Good answer', reasons: [] } },
    }),
  })
  const model = require(path.join(root, 'models/interviewModel.js'))
  const service = require(path.join(root, 'services/interviewService.js'))
  const tag = Date.now()
  let u1, u2, session, q

  async function fresh() {
    session = await model.createSession({ userId: u1.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })
    q = []
    for (let i = 0; i < 3; i++) q.push(await model.createQuestion({ sessionId: session.id, topicId: null, questionText: `question ${i}`, orderIndex: i }))
  }

  test('setup', async () => {
    u1 = (await testPool.query(`INSERT INTO users (email, password_hash, name) VALUES ('sr1${tag}@t.test', 'x', 'S1') RETURNING id`)).rows[0]
    u2 = (await testPool.query(`INSERT INTO users (email, password_hash, name) VALUES ('sr2${tag}@t.test', 'x', 'S2') RETURNING id`)).rows[0]
  })

  test('skipping stores a zero-score "skipped" answer, moves on, and counts as 0 in the final score', async () => {
    await fresh()
    const r = await service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: q[0].id })
    assert.equal(r.answer.evaluation_meta.skipped, true)
    assert.equal(r.answer.evaluation_meta.answerQuality.status, 'skipped')
    assert.deepEqual([r.answer.technical_score, r.answer.relevance_score, r.answer.clarity_score, r.answer.completeness_score].map(Number), [0, 0, 0, 0])
    assert.equal(r.nextQuestion.id, q[1].id); assert.equal(r.sessionComplete, false)
    nextScore = 80
    await service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[1].id, answerText: 'a real answer here' })
    const last = await service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: q[2].id })
    assert.equal(last.sessionComplete, true)
    const done = await service.completeInterviewSession(session.id, u1.id)
    assert.ok(Math.abs(Number(done.final_score) - 80 / 3) < 0.05, `final score ${done.final_score}`)
  })

  test('a question that already has an answer cannot be skipped', async () => {
    await fresh()
    await service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[0].id, answerText: 'first answer text' })
    await assert.rejects(service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: q[0].id }), (e) => e.statusCode === 409)
  })

  test('answering a skipped question later replaces it and keeps the skip in history', async () => {
    await fresh()
    await service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: q[0].id })
    nextScore = 90
    const r = await service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[0].id, answerText: 'now I answer it properly' })
    assert.equal(Number(r.answer.technical_score), 90)
    assert.equal(r.answer.evaluation_meta.attemptCount, 2)
    assert.equal(r.answer.evaluation_meta.previousAttempts.length, 1)
    assert.equal(r.answer.evaluation_meta.previousAttempts[0].skipped, true)
    assert.equal(r.answer.evaluation_meta.answerQuality.status, 'good')
    const rows = (await testPool.query('SELECT count(*)::int AS n FROM interview_answers WHERE question_id = $1', [q[0].id])).rows[0]
    assert.equal(rows.n, 1) // replaced, not duplicated
  })

  test('retrying an answered question replaces scores, keeps the earlier attempt (capped), clears camera data and stale STAR coaching', async () => {
    await fresh()
    nextScore = 40
    await service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[0].id, answerText: 'weak first try about this' })
    await model.updateAnswerEvaluation(q[0].id, { cvMetrics: { face_presence_pct: 50 } })
    await testPool.query(`INSERT INTO ai_feedback (user_id, kind, ref_id, source, payload) VALUES ($1, 'star', $2, 'rule_based', '{"x":1}')`, [u1.id, q[0].id])
    nextScore = 85
    const r = await service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[0].id, answerText: 'much better second try about this' })
    const a = r.answer
    assert.equal(Number(a.technical_score), 85); assert.equal(a.answer_text, 'much better second try about this')
    assert.equal(a.cv_metrics, null)
    assert.equal(a.evaluation_meta.attemptCount, 2)
    assert.equal(a.evaluation_meta.previousAttempts[0].average, 40)
    assert.equal(a.evaluation_meta.previousAttempts[0].preview, 'weak first try about this')
    const star = (await testPool.query(`SELECT count(*)::int AS n FROM ai_feedback WHERE kind = 'star' AND ref_id = $1`, [q[0].id])).rows[0]
    assert.equal(star.n, 0)
    for (let i = 0; i < 8; i++) await service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[0].id, answerText: `attempt number ${i} for this` })
    const last = await model.getAnswerByQuestion(q[0].id)
    assert.equal(last.evaluation_meta.previousAttempts.length, 5) // history is capped
    assert.equal(last.evaluation_meta.attemptCount, 10)
  })

  test('a completed interview is locked: no skip, no retry', async () => {
    await fresh()
    for (const x of q) await service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: x.id })
    await service.completeInterviewSession(session.id, u1.id)
    await assert.rejects(service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: q[0].id }), (e) => e.statusCode === 409)
    await assert.rejects(service.submitAnswer({ sessionId: session.id, userId: u1.id, questionId: q[0].id, answerText: 'too late to change' }), (e) => e.statusCode === 409)
  })

  test('another user cannot skip or retry in my session, and a foreign question is rejected', async () => {
    await fresh()
    await assert.rejects(service.skipQuestion({ sessionId: session.id, userId: u2.id, questionId: q[0].id }), (e) => e.statusCode === 404)
    await assert.rejects(service.submitAnswer({ sessionId: session.id, userId: u2.id, questionId: q[0].id, answerText: 'not my session at all' }), (e) => e.statusCode === 404)
    const other = await model.createSession({ userId: u1.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })
    const oq = await model.createQuestion({ sessionId: other.id, topicId: null, questionText: 'other', orderIndex: 0 })
    await assert.rejects(service.skipQuestion({ sessionId: session.id, userId: u1.id, questionId: oq.id }), (e) => e.statusCode === 404)
  })

  test('cleanup', async () => {
    await testPool.query('DELETE FROM users WHERE id = ANY($1)', [[u1.id, u2.id]])
  })
}

// Pure checks that need no database.
const { hirerQuality } = require(path.join(root, 'utils/answerQuality.js'))
test('hirer view: skipped is labelled, not "evaluable", and attempts are only shown above 1', () => {
  assert.deepEqual(hirerQuality('skipped', undefined, null), { status: 'skipped', label: 'Skipped', evaluable: false, skipped: true, lowConfidence: false, attempts: 1 })
  assert.equal(hirerQuality('good', 'medium', '3').attempts, 3)
  assert.equal(hirerQuality('good', 'medium', '1').attempts, 1)
  assert.equal(hirerQuality('good', 'medium', 'abc').attempts, 1)
  assert.equal(hirerQuality('nonsense', null, 2), null)
})
