// Phase H: optional evaluator-confidence metadata through the Node side (client sanitising, DB persistence, privacy).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const { root, stubModule } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const client = require(path.join(root, 'services/aiServiceClient.js'))

const baseEval = {
  technicalScore: 70, relevanceScore: 60, clarityScore: 80, completenessScore: 50,
  strengths: ['a'], weaknesses: ['b'], suggestedImprovement: 'c', modelAnswer: 'd',
}

test('extractEvaluationMeta: old AI service responses (no new fields) give null, not an error', () => {
  assert.equal(client.extractEvaluationMeta(baseEval), null)
  assert.equal(client.extractEvaluationMeta(null), null)
  assert.equal(client.extractEvaluationMeta({ ...baseEval, confidence: 'certain' }), null)
})

test('extractEvaluationMeta: keeps valid fields and drops malformed ones', () => {
  const m = client.extractEvaluationMeta({
    ...baseEval, confidence: 'low', confidenceNote: 'n'.repeat(900), rubricId: 'deadlock', rubricKind: 'concept',
    matchedCriteria: ['x', 5, null, 'y'], missingCriteria: 'not-a-list',
  })
  assert.equal(m.confidence, 'low'); assert.equal(m.confidenceNote.length, 600); assert.equal(m.rubricId, 'deadlock')
  assert.deepEqual(m.matchedCriteria, ['x', 'y']); assert.deepEqual(m.missingCriteria, [])
  assert.equal(client.extractEvaluationMeta({ ...baseEval, confidence: 'high', rubricKind: 'bogus' }).rubricKind, null)
})

test('evaluateAnswer: attaches evaluationMeta; still rejects an invalid score payload with a 503', async () => {
  const realFetch = global.fetch
  process.env.AI_SERVICE_URL = 'http://ai.test'
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ ...baseEval, confidence: 'medium', confidenceNote: 'x', rubricId: 'r', rubricKind: 'star' }) })
    const r = await client.evaluateAnswer({ questionText: 'q', answerText: 'a' })
    assert.equal(r.technicalScore, 70); assert.equal(r.evaluationMeta.rubricKind, 'star')
    global.fetch = async () => ({ ok: true, json: async () => baseEval })
    assert.equal((await client.evaluateAnswer({ questionText: 'q', answerText: 'a' })).evaluationMeta, null)
    global.fetch = async () => ({ ok: true, json: async () => ({ ...baseEval, technicalScore: 250, confidence: 'high' }) })
    await assert.rejects(client.evaluateAnswer({ questionText: 'q', answerText: 'a' }), (e) => e.statusCode === 503)
  } finally { global.fetch = realFetch }
})

test('hirer-facing queries read only status+confidence from evaluation_meta, and never model_answer or suggested_improvement', () => {
  const src = fs.readFileSync(path.join(root, 'models/hirerApplicationModel.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
  // evaluation_meta holds coaching text, so hirer queries may read ONLY these three fields out of it (answer-quality status, confidence level and the number of attempts).
  const allowedMetaReads = ["evaluation_meta->'answerQuality'->>'status'", "evaluation_meta->>'confidence'", "evaluation_meta->>'attemptCount'"]
  const metaUses = src.match(/evaluation_meta[^\s,)]*/g) || []
  for (const use of metaUses) assert.ok(allowedMetaReads.includes(use), `hirerApplicationModel may only read the status/confidence out of evaluation_meta, found: ${use}`)
  for (const col of ['model_answer', 'suggested_improvement', 'speech_metrics', 'cv_metrics', 'typing_metrics', 'behavior_summary']) {
    assert.ok(!src.includes(col), `hirerApplicationModel must not select ${col}`)
  }
})

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase H evaluation_meta DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  const model = require(path.join(root, 'models/interviewModel.js'))
  const tag = Date.now()

  test('createAnswer persists evaluation_meta as JSONB; answers without it keep NULL', async () => {
    const u = (await testPool.query(`INSERT INTO users (email, password_hash, name) VALUES ('em${tag}@h.test', 'x', 'EM') RETURNING id`)).rows[0]
    const s = await model.createSession({ userId: u.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })
    const q1 = await model.createQuestion({ sessionId: s.id, topicId: null, questionText: 'q1', orderIndex: 0 })
    const q2 = await model.createQuestion({ sessionId: s.id, topicId: null, questionText: 'q2', orderIndex: 1 })
    const meta = { confidence: 'low', confidenceNote: 'too short', rubricId: 'deadlock', rubricKind: 'concept', matchedCriteria: [], missingCriteria: ['a'] }
    await model.createAnswer({ questionId: q1.id, answerText: 'hi', ...baseEval, evaluationMeta: meta })
    await model.createAnswer({ questionId: q2.id, answerText: 'hi', ...baseEval })
    const a1 = await model.getAnswerByQuestion(q1.id); const a2 = await model.getAnswerByQuestion(q2.id)
    assert.deepEqual(a1.evaluation_meta, meta)
    assert.equal(a2.evaluation_meta, null)
    await testPool.query('DELETE FROM users WHERE id = $1', [u.id])
  })
}
