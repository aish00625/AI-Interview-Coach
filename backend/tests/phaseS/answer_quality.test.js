// Answer-quality status through the Node side: whitelisting, label control, pass-through of the evaluation, old-service compatibility.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { root } = require('../phaseA/helpers')
const client = require(path.join(root, 'services/aiServiceClient.js'))

const base = { technicalScore: 0, relevanceScore: 0, clarityScore: 0, completenessScore: 0, strengths: [], weaknesses: ['could not be evaluated'], suggestedImprovement: 's', modelAnswer: 'm' }
const quality = (o = {}) => ({ status: 'not_evaluable', label: 'LIES', evaluable: true, reasons: ['Most of the text does not look like real words.'], wordCount: 1, meaningfulWordCount: 0, wordLikeRatio: 0, scoreBasis: 'STAR element coverage', ...o })
const withFetch = async (body, fn) => {
  const real = global.fetch; const url = process.env.AI_SERVICE_URL
  process.env.AI_SERVICE_URL = 'http://ai.test'
  global.fetch = async () => ({ ok: true, status: 200, json: async () => body })
  try { return await fn() } finally { global.fetch = real; if (url === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = url }
}

test('the label and the evaluable flag come from the status, never from the AI service response', () => {
  const q = client.sanitizeAnswerQuality(quality())
  assert.equal(q.status, 'not_evaluable'); assert.equal(q.label, 'Not evaluable'); assert.equal(q.evaluable, false)
  const good = client.sanitizeAnswerQuality(quality({ status: 'good', evaluable: false, label: 'Not evaluable' }))
  assert.equal(good.label, 'Good answer'); assert.equal(good.evaluable, true)
})

test('every known status is accepted and unknown or malformed ones become null', () => {
  for (const status of Object.keys(client.ANSWER_QUALITY_LABELS)) assert.equal(client.sanitizeAnswerQuality(quality({ status })).status, status)
  for (const bad of [undefined, null, 'x', 5, [], {}, quality({ status: 'excellent' }), quality({ status: '__proto__' }), quality({ status: 'constructor' }), quality({ status: 'toString' })]) {
    assert.equal(client.sanitizeAnswerQuality(bad), null, JSON.stringify(bad))
  }
})

test('reasons and numbers are bounded and typed', () => {
  const q = client.sanitizeAnswerQuality(quality({ reasons: ['a'.repeat(1000), 5, null, '', '  ', 'b', 'c', 'd', 'e', 'f', 'g'], wordCount: -3, meaningfulWordCount: 1.5, wordLikeRatio: 9, scoreBasis: 'x'.repeat(500) }))
  assert.equal(q.reasons.length, 5); assert.equal(q.reasons[0].length, 400)
  assert.equal(q.wordCount, null); assert.equal(q.meaningfulWordCount, null); assert.equal(q.wordLikeRatio, 1); assert.equal(q.scoreBasis.length, 120)
  assert.deepEqual(Object.keys(q).sort(), ['evaluable', 'label', 'meaningfulWordCount', 'reasons', 'scoreBasis', 'status', 'wordCount', 'wordLikeRatio'])
})

test('extra keys are dropped', () => {
  const q = client.sanitizeAnswerQuality({ ...quality(), html: '<script>alert(1)</script>', score: 99 })
  assert.ok(!('html' in q) && !('score' in q))
})

test('evaluateAnswer keeps the quality status inside evaluationMeta, scores untouched', async () => {
  const r = await withFetch({ ...base, confidence: 'low', confidenceNote: 'n', rubricId: 'pk_vs_fk', rubricKind: 'concept', answerQuality: quality() },
    () => client.evaluateAnswer({ questionText: 'q', answerText: 'dshdgubc' }))
  assert.equal(r.clarityScore, 0)
  assert.equal(r.evaluationMeta.answerQuality.status, 'not_evaluable')
  assert.equal(r.evaluationMeta.answerQuality.label, 'Not evaluable')
  assert.equal(r.evaluationMeta.confidence, 'low')
})

test('an older AI service without answerQuality still works', async () => {
  const r = await withFetch({ ...base, technicalScore: 70, confidence: 'medium', confidenceNote: 'n' }, () => client.evaluateAnswer({ questionText: 'q', answerText: 'a' }))
  assert.equal(r.evaluationMeta.answerQuality, null); assert.equal(r.technicalScore, 70)
})

test('empty strengths are a valid evaluation (nothing is invented to fill the list)', async () => {
  const r = await withFetch({ ...base, confidence: 'low', answerQuality: quality() }, () => client.evaluateAnswer({ questionText: 'q', answerText: 'x' }))
  assert.deepEqual(r.strengths, [])
})
