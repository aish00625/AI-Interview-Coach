const test = require('node:test')
const assert = require('node:assert/strict')
const { computeScoreBreakdown, loadWeights, DEFAULT_WEIGHTS } = require('../../utils/scoreModel')
const { computeBehaviorSummary } = require('../../utils/behaviorScoring')

const content = (n) => ({ technical: n, relevance: n, clarity: n, completeness: n })
const comp = (key, label, score) => ({ key, label, score, detail: `${key} ${score}` })
const ans = (n, comps = [], extra = {}) => ({ ...content(n), behavior: { components: comps }, ...extra })
const speech = [comp('pace', 'Speaking pace', 80), comp('fluency', 'Fluency', 60), comp('pausing', 'Pauses', 100)]
const typing = [comp('typingPace', 'Typing pace', 90), comp('editing', 'Corrections', 70), comp('continuity', 'Continuity', 50), comp('originality', 'Typed', 100)]
const camera = [comp('presence', 'Presence', 90), comp('attention', 'Attention', 70)]
const cat = (b, k) => b.categories.find((c) => c.key === k)
const sum = (xs) => xs.reduce((a, b) => a + b, 0)

test('default weights add up to 100', () => assert.equal(sum(Object.values(DEFAULT_WEIGHTS)), 100))

test('all signals present: weights, points and final score follow the formula', () => {
  const b = computeScoreBreakdown([ans(80, [...speech, ...typing, ...camera])])
  assert.equal(cat(b, 'content').score, 80)
  assert.equal(cat(b, 'speech').score, 78) // .4*80+.35*60+.25*100
  assert.equal(cat(b, 'typing').score, 79.5) // .3*90+.25*70+.2*50+.25*100
  assert.equal(cat(b, 'camera').score, 80)
  assert.equal(sum(b.categories.map((c) => c.appliedWeight)), 100)
  const expected = 80 * 0.7 + 78 * 0.12 + 79.5 * 0.1 + 80 * 0.08
  assert.equal(b.finalScore, Math.round(expected * 100) / 100)
  assert.equal(sum(b.categories.map((c) => c.points)).toFixed(1), b.finalScore.toFixed(1))
})

test('missing signals are unavailable (not zero) and weights renormalise', () => {
  const b = computeScoreBreakdown([ans(80, typing)])
  assert.equal(cat(b, 'speech').status, 'unavailable')
  assert.equal(cat(b, 'speech').score, null)
  assert.match(cat(b, 'speech').reason, /No voice/)
  assert.equal(cat(b, 'camera').status, 'unavailable')
  assert.equal(cat(b, 'content').appliedWeight, 87.5) // 70/80
  assert.equal(cat(b, 'typing').appliedWeight, 12.5)
  assert.equal(sum(b.categories.map((c) => c.appliedWeight)), 100)
})

test('all optional signals missing: equals the content-only score', () => {
  const b = computeScoreBreakdown([ans(70), ans(90)])
  assert.equal(b.finalScore, 80)
  assert.equal(cat(b, 'content').appliedWeight, 100)
  for (const k of ['speech', 'typing', 'camera']) assert.equal(cat(b, k).status, 'unavailable')
})

test('a missing component inside a category does not count as zero', () => {
  const b = computeScoreBreakdown([ans(80, [comp('presence', 'Presence', 90)])])
  assert.equal(cat(b, 'camera').score, 90)
  assert.match(cat(b, 'camera').limitation, /Head and gaze/)
})

test('camera with almost no face visible is excluded, not penalised', () => {
  const b = computeScoreBreakdown([ans(80, camera, { cv: { facePresenceRatio: 0.1 }, flags: { hasCamera: true } })])
  assert.equal(cat(b, 'camera').status, 'unavailable')
  assert.match(cat(b, 'camera').reason, /lighting|camera position/)
  assert.equal(b.finalScore, 80)
})

test('camera is labelled experimental and measured categories are labelled as measured', () => {
  const b = computeScoreBreakdown([ans(80, camera)])
  assert.equal(cat(b, 'camera').experimental, true)
  assert.equal(cat(b, 'camera').kind, 'measured')
  assert.equal(cat(b, 'content').kind, 'automated_evaluation')
})

test('only answers that have a signal count toward that category', () => {
  const b = computeScoreBreakdown([ans(80, speech), ans(80)])
  assert.deepEqual(cat(b, 'speech').coverage, { answersMeasured: 1, answersTotal: 2 })
})

test('does not mutate its input and never throws on empty input', () => {
  const input = [ans(80, speech)]
  const copy = JSON.stringify(input)
  computeScoreBreakdown(input)
  assert.equal(JSON.stringify(input), copy)
  assert.equal(computeScoreBreakdown([]).finalScore, 0)
})

test('weight configuration: defaults, scaling, and unsafe values fall back', () => {
  assert.deepEqual(loadWeights({}).weights, DEFAULT_WEIGHTS)
  const scaled = loadWeights({ SCORE_WEIGHT_CONTENT: '7', SCORE_WEIGHT_SPEECH: '1.2', SCORE_WEIGHT_TYPING: '1', SCORE_WEIGHT_CAMERA: '0.8' })
  assert.deepEqual(scaled.weights, DEFAULT_WEIGHTS)
  assert.equal(scaled.source, 'configured')
  for (const bad of [{ SCORE_WEIGHT_CONTENT: 'abc' }, { SCORE_WEIGHT_CONTENT: '-1' }, { SCORE_WEIGHT_CONTENT: '30', SCORE_WEIGHT_SPEECH: '30', SCORE_WEIGHT_TYPING: '20', SCORE_WEIGHT_CAMERA: '20' }, { SCORE_WEIGHT_CAMERA: '40' }]) {
    const r = loadWeights(bad)
    assert.deepEqual(r.weights, DEFAULT_WEIGHTS)
    assert.ok(r.warnings.length)
  }
})

test('a zero weight disables a category without breaking the sum', () => {
  const { weights } = loadWeights({ SCORE_WEIGHT_CONTENT: '80', SCORE_WEIGHT_SPEECH: '10', SCORE_WEIGHT_TYPING: '10', SCORE_WEIGHT_CAMERA: '0' })
  const b = computeScoreBreakdown([ans(80, camera)], { weights })
  assert.equal(cat(b, 'camera').status, 'disabled')
  assert.equal(b.finalScore, 80)
})

test('works with real behaviour summaries (typing + speech + camera metrics)', () => {
  const behavior = computeBehaviorSummary({
    speechMetrics: { wordCount: 120, wordsPerMinute: 140, articulationRateWpm: 150, disfluencyRatePer100Words: 1, longPauseCount: 0, durationSeconds: 50 },
    cvMetrics: { analysisStatus: 'ok', framesAnalyzed: 30, facePresenceRatio: 0.95, lookingAwayRatio: 0.1, framesWithGaze: 28 },
    typingMetrics: { typingSpeedWpm: 45, correctionRatio: 0.05, pausesPer100Chars: 0.5, longPauseCount: 0, pasteShare: 0, charCount: 300, keyCount: 300 },
  })
  const b = computeScoreBreakdown([{ ...content(75), behavior, cv: { facePresenceRatio: 0.95 }, flags: { hasSpeech: true, hasTyping: true, hasCamera: true } }])
  assert.ok(b.finalScore > 0 && b.finalScore <= 100)
  assert.equal(b.categories.filter((c) => c.status === 'measured').length >= 1, true)
})

test('coding code imports no scoring or behaviour modules', () => {
  const fs = require('node:fs'); const path = require('node:path')
  const root = path.join(__dirname, '..', '..')
  const files = ['services/codingService.js', 'controllers/codingController.js', 'routes/codingRoutes.js'].filter((f) => fs.existsSync(path.join(root, f)))
  assert.ok(files.length)
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /scoreModel|behaviorScoring|combinedSummary|score_breakdown/, f)
})
