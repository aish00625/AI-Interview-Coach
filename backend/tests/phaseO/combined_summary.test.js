const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCombinedSummary } = require('../../utils/combinedSummary')
const { computeBehaviorSummary, summarizeSession } = require('../../utils/behaviorScoring')

const cv = (away, presence = 0.95) => ({ facePresenceRatio: presence, framesAnalyzed: 40, lookingAwayRatio: away, framesWithGaze: 40, analysisStatus: 'complete' })
const speech = { speakingRateWpm: 140, articulationRateWpm: 150, disfluencyRatePer100Words: 1, longPauseCount: 0, wordCount: 120, durationSeconds: 50, reliable: true }

test('roll-up: per-component mean over answers, with the weakest real measurement quoted', () => {
  const a = computeBehaviorSummary({ speechMetrics: speech, cvMetrics: cv(0.1) })
  const b = computeBehaviorSummary({ speechMetrics: speech, cvMetrics: cv(0.5) })
  const s = summarizeSession([a, b, null])
  const att = s.components.find((c) => c.key === 'attention')
  assert.equal(att.answers, 2)
  assert.match(att.weakestDetail, /50%/)
  assert.ok(att.score < a.components.find((c) => c.key === 'attention').score)
})

test('combined summary: strong content + weak camera attention -> tip with the real percentage', () => {
  const delivery = summarizeSession([computeBehaviorSummary({ speechMetrics: speech, cvMetrics: cv(0.5) })])
  const out = buildCombinedSummary({ finalScore: 82, delivery })
  assert.match(out.text, /solid on content \(82\/100\)/); assert.match(out.text, /Biggest delivery gain: facing the camera/)
  const tip = out.tips.find((t) => t.key === 'attention')
  assert.ok(tip); assert.match(tip.measured, /50%/); assert.match(tip.tip, /camera lens/)
  assert.equal(out.advisory, true)
})

test('combined summary: nothing is produced without BOTH a content score and a delivery score (no invented numbers)', () => {
  assert.equal(buildCombinedSummary({ finalScore: 80, delivery: { score: null } }), null)
  assert.equal(buildCombinedSummary({ finalScore: null, delivery: { score: 70, components: [] } }), null)
  assert.equal(buildCombinedSummary({ finalScore: 80, delivery: null }), null)
})

test('combined summary: weak content is named first and wording never uses emotion/confidence claims', () => {
  const out = buildCombinedSummary({ finalScore: 40, delivery: { score: 45, components: [{ key: 'pace', label: 'Speaking pace', score: 30, weakestDetail: '210 words per minute.' }] } })
  assert.match(out.text, /content comes first/)
  assert.equal(/nervous|anxious|confident person|dishonest|emotion detected/i.test(JSON.stringify(out.tips) + out.text), false)
  assert.equal(out.tips.length, 1)
})

test('combined summary never alters the scores it was given', () => {
  const delivery = { score: 60, components: [] }
  const before = JSON.stringify(delivery)
  buildCombinedSummary({ finalScore: 75, delivery })
  assert.equal(JSON.stringify(delivery), before)
})
