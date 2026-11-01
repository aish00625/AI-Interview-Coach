const test = require('node:test')
const assert = require('node:assert/strict')
const { sanitizeCameraSignals, MAX_POINTS } = require('../../utils/cameraSignals')

const good = () => ({
  eyeContactRatio: 0.8, facingCameraRatio: 0.75,
  headMovement: { level: 'moderate', yawSpread: 6.123, pitchSpread: 4, rollSpread: 2, meanChangeDeg: 3.3, framesMeasured: 20 },
  expressionVariation: { level: 'low', spread: 0.01234, framesMeasured: 20 },
  framing: { level: 'good', wellFramedRatio: 0.9, meanFaceHeight: 0.4, meanCentreX: 0.5, meanCentreY: 0.45, hints: ['Sit closer.'], framesMeasured: 20 },
  timeline: { durationSeconds: 12.34, points: [{ t: 0, face: 1, facing: 1, expression: null, head: null }, { t: 0.5, face: 0, facing: 0, expression: 0.3, head: 0.1 }] },
})

test('valid signals pass through, rounded', () => {
  const out = sanitizeCameraSignals(good())
  assert.equal(out.eyeContactRatio, 0.8); assert.equal(out.headMovement.yawSpread, 6.1); assert.equal(out.expressionVariation.spread, 0.0123)
  assert.equal(out.timeline.points.length, 2); assert.equal(out.timeline.durationSeconds, 12.3); assert.equal(out.framing.hints[0], 'Sit closer.')
})

test('missing or malformed signals become null, never 0', () => {
  for (const bad of [undefined, null, 'x', {}, { headMovement: 'x', timeline: [] }]) {
    const out = sanitizeCameraSignals(bad)
    for (const v of Object.values(out)) assert.equal(v, null)
  }
  const out = sanitizeCameraSignals({ headMovement: { level: 'extreme' }, expressionVariation: { level: 'happy' }, framing: { level: 'great' }, eyeContactRatio: 'a', facingCameraRatio: NaN })
  for (const v of Object.values(out)) assert.equal(v, null)
})

test('out-of-range numbers are clamped and extra keys are dropped', () => {
  const g = good(); g.eyeContactRatio = 4; g.headMovement.evil = '<script>'; g.framing.extra = { big: 'x'.repeat(1e5) }
  const out = sanitizeCameraSignals(g)
  assert.equal(out.eyeContactRatio, 1); assert.ok(!('evil' in out.headMovement)); assert.ok(!('extra' in out.framing))
})

test('timeline is bounded and bad points are dropped; flags must be 0/1/null', () => {
  const points = Array.from({ length: 500 }, (_, i) => ({ t: i / 500, face: 1, facing: 2, expression: 9, head: -3 }))
  points.push(null, { t: 'x' })
  const out = sanitizeCameraSignals({ timeline: { points, durationSeconds: 'x' } })
  assert.equal(out.timeline.points.length, MAX_POINTS); assert.equal(out.timeline.points[0].facing, null)
  assert.equal(out.timeline.points[0].expression, 1); assert.equal(out.timeline.points[0].head, 0); assert.equal(out.timeline.durationSeconds, null)
})

test('hints are capped in number and length', () => {
  const g = good(); g.framing.hints = Array.from({ length: 20 }, () => 'y'.repeat(500)); g.framing.hints.push(5)
  const out = sanitizeCameraSignals(g)
  assert.equal(out.framing.hints.length, 4); assert.ok(out.framing.hints.every((h) => h.length <= 160))
})

const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
test('snapshots: only small JPEG data URIs with known labels survive', () => {
  const out = sanitizeCameraSignals({ snapshots: [
    { t: 0.2, kinds: ['framed', 'bogus', 'framed'], image: px },
    { t: 0.4, kinds: ['away'], image: 'data:image/svg+xml;base64,PHN2Zz4=' },          // not a JPEG
    { t: 0.5, kinds: ['away'], image: 'https://evil.example/x.jpg' },                    // not a data URI
    { t: 0.6, kinds: ['away'], image: 'data:image/jpeg;base64,' + 'A'.repeat(100000) }, // too big
    { t: 0.7, kinds: ['nonsense'], image: px },                                         // no known label
    { t: 'x', kinds: ['calm'], image: px },
    null, 'x',
  ] })
  assert.equal(out.snapshots.length, 1)
  assert.deepEqual(out.snapshots[0].kinds, ['framed']); assert.equal(out.snapshots[0].image, px)
})

test('snapshots: at most MAX_SNAPSHOTS, none when switched off, null when absent', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ t: i / 30, kinds: ['facing'], image: px }))
  assert.equal(sanitizeCameraSignals({ snapshots: many }).snapshots.length, require('../../utils/cameraSignals').MAX_SNAPSHOTS)
  assert.equal(sanitizeCameraSignals({ snapshots: many }, { keepSnapshots: false }).snapshots, null)
  assert.equal(sanitizeCameraSignals({}).snapshots, null)
})

test('hiring assessments never keep face pictures: the service only keeps them for practice interviews', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../services/interviewService.js'), 'utf8')
  assert.match(src, /keepSnapshots = !session\.application_id/)
  assert.match(src, /analyzeVideoAnswer\(\{ videoBuffer, videoMimeType, keepSnapshots \}\)/)
})
