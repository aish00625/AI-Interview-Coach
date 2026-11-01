import test from 'node:test'
import assert from 'node:assert/strict'
import { answerScores, overallScore, qualityView, attemptsView, verdict, scoreTone, cameraView, signalGuide, timelineView, typingView, idealAnswer, givenAnswer } from './resultsView.js'

const ans = (o = {}) => ({ technical_score: '85.00', relevance_score: '90.00', clarity_score: '78.00', completeness_score: '75.00', ...o })

test('scores arrive as strings from the API; a missing score is null, never 0', () => {
  assert.deepEqual(answerScores(ans()).map((s) => s.value), [85, 90, 78, 75])
  assert.deepEqual(answerScores(ans({ clarity_score: null })).map((s) => s.value), [85, 90, null, 75])
  assert.equal(answerScores(null)[0].value, null)
})

test('overall is the plain average of all four, and null when any is missing', () => {
  assert.equal(overallScore(ans()), 82)
  assert.equal(overallScore(ans({ clarity_score: null })), null)
  assert.equal(overallScore(ans({ technical_score: 0 })), 61) // a real zero counts
})

test('score tone bands', () => {
  assert.deepEqual([90, 75, 74, 50, 49, null].map(scoreTone), ['success', 'success', 'warning', 'warning', 'danger', 'muted'])
})

test('verdict wording follows the band and names strongest and weakest', () => {
  const v = verdict(ans())
  assert.equal(v.title, 'Strong answer'); assert.equal(v.score, 82)
  assert.match(v.notes[0], /Strongest: Relevance \(90\)\. Weakest: Completeness \(75\)/)
  assert.equal(verdict(ans({ technical_score: 20, relevance_score: 30, clarity_score: 50, completeness_score: 40 })).title, 'Needs more work')
  assert.equal(verdict(ans({ clarity_score: null })).title, 'Scores unavailable')
})

test('low-confidence evaluations say the scores are rough', () => {
  const v = verdict(ans({ evaluation_meta: { confidence: 'low', rubricId: null } }))
  assert.ok(v.notes.some((x) => /rough/.test(x)))
  assert.ok(!verdict(ans({ evaluation_meta: { confidence: 'high', rubricId: 'x' } })).notes.some((x) => /rough/.test(x)))
})

const fullCv = () => ({
  analysisStatus: 'complete', framesAnalyzed: 12, facePresenceRatio: 0.95, facingCameraRatio: 0.82, eyeContactRatio: 0.76,
  lookingAwayRatio: 0.24, averageGazeDeviation: 0.123, headPose: { yaw: 3.4, pitch: -2.2, roll: 0.5 },
  headMovement: { level: 'moderate', yawSpread: 6.1, pitchSpread: 4.2 }, expressionVariation: { level: 'low', spread: 0.01 },
  framing: { level: 'good', wellFramedRatio: 0.9, hints: [] },
})

test('camera view: six tiles for a full analysis, with plain-language levels', () => {
  const v = cameraView(fullCv())
  assert.deepEqual(v.tiles.map((t) => t.key), ['presence', 'facing', 'head', 'expression', 'eye', 'framing'])
  const by = Object.fromEntries(v.tiles.map((t) => [t.key, t]))
  assert.equal(by.presence.value, '95%'); assert.equal(by.facing.value, '82%'); assert.equal(by.head.value, 'Moderate')
  assert.equal(by.expression.value, 'Low'); assert.equal(by.eye.value, '76%'); assert.equal(by.framing.value, 'Good')
  assert.match(by.framing.hint, /not body posture/); assert.match(by.expression.hint, /facial movement/)
  assert.ok(v.observations.some((o) => /faced the camera for most/.test(o)))
  assert.ok(v.details.some((d) => /Average head angle/.test(d)))
})

test('camera view: without the face model the landmark tiles say Unavailable, never 0', () => {
  const v = cameraView({ analysisStatus: 'model_unavailable', facePresenceRatio: 0.5, framesAnalyzed: 5 })
  const by = Object.fromEntries(v.tiles.map((t) => [t.key, t]))
  assert.equal(by.presence.value, '50%')
  for (const k of ['facing', 'head', 'expression', 'eye', 'framing']) { assert.equal(by[k].value, 'Unavailable', k); assert.equal(by[k].muted, true) }
  assert.ok(v.observations.some((o) => /could not be measured/.test(o))); assert.ok(v.observations.some((o) => /out of view/.test(o)))
})

test('camera view: older saved answers keep working (eye contact is derived from looking-away)', () => {
  const v = cameraView({ analysisStatus: 'complete', facePresenceRatio: 1, lookingAwayRatio: 0.2, averageGazeDeviation: 0.1, headPose: { yaw: 1, pitch: 1, roll: 1 } })
  assert.deepEqual(v.tiles.map((t) => t.key), ['presence', 'eye'])
  assert.equal(v.tiles[1].value, '80%')
  assert.equal(cameraView(null), null)
})

test('camera wording never claims emotion, honesty, confidence, engagement, attention or body posture', () => {
  for (const level of ['low', 'moderate', 'high']) {
    const v = cameraView({ ...fullCv(), headMovement: { level }, expressionVariation: { level }, facingCameraRatio: level === 'low' ? 0.2 : 0.9 })
    const all = JSON.stringify(v).toLowerCase().replace(/not body posture/g, '').replace(/movement only, not feelings/g, '')
    for (const w of ['emotion', 'honest', 'confident', 'engag', 'attention', 'nervous', 'anxious', 'happy', 'sad', 'posture', 'feeling', 'mood']) assert.ok(!all.includes(w), w)
  }
})

test('timeline: unmeasured points break the line instead of being drawn as zero', () => {
  const pts = [
    { t: 0, face: 1, facing: 1, expression: null, head: null },
    { t: 0.25, face: 1, facing: 0, expression: 0.2, head: 0.1 },
    { t: 0.5, face: 0, facing: 0, expression: null, head: 0.3 },
    { t: 0.75, face: 1, facing: null, expression: 0.4, head: 0.2 },
    { t: 1, face: 1, facing: 1, expression: 0.1, head: 0 },
  ]
  const v = timelineView({ timeline: { points: pts, durationSeconds: 20 } })
  const by = Object.fromEntries(v.series.map((s) => [s.key, s]))
  assert.equal(by.expression.segments.length, 2)            // broken at the null at t=0.5
  assert.deepEqual(by.expression.segments[0], [{ x: 0.25, y: 0.2 }])
  assert.equal(by.facing.segments.length, 2)
  assert.deepEqual(v.ticks.map((t) => t.label), ['0s', '5s', '10s', '15s', '20s'])
})

test('timeline: a series with no measured points is dropped; too little data gives no chart', () => {
  const pts = [0, 0.5, 1].map((t) => ({ t, face: 1, facing: null, expression: null, head: null }))
  assert.deepEqual(timelineView({ timeline: { points: pts } }).series.map((s) => s.key), ['face'])
  assert.deepEqual(timelineView({ timeline: { points: pts } }).ticks.map((t) => t.label), ['Start', 'End'])
  assert.equal(timelineView({ timeline: { points: pts.slice(0, 2) } }), null)
  assert.equal(timelineView({ timeline: null }), null); assert.equal(timelineView(null), null)
  assert.equal(timelineView({ timeline: { points: pts.map((p) => ({ ...p, face: null })) } }), null)
})

test('typing view: tiles for what exists, neutral observations, no zero for missing values', () => {
  const v = typingView({ typingSpeedWpm: 38.4, longPauseCount: 2, longestPauseMs: 4200, timeToFirstKeyMs: 10400, correctionRatio: 0.1, pasteShare: 0 })
  assert.deepEqual(v.tiles.map((t) => t.key), ['wpm', 'pauses', 'longest', 'first', 'edits'])
  assert.equal(v.tiles[0].value, '38'); assert.equal(v.tiles[3].value, '10.4')
  assert.ok(v.observations.some((o) => /Pausing to think is normal/.test(o)))
  const sparse = typingView({ typingSpeedWpm: null, longPauseCount: null })
  assert.equal(sparse.empty, true)
  assert.ok(typingView({ longPauseCount: 0, pasteShare: 0.4 }).observations.some((o) => /40% of the answer was pasted/.test(o)))
  assert.equal(typingView(null), null)
})

test('ideal answer: real text is trimmed with a full version, the placeholder is flagged, empty is none', () => {
  const long = 'word '.repeat(100).trim()
  const a = idealAnswer({ model_answer: long })
  assert.equal(a.kind, 'available'); assert.equal(a.truncated, true); assert.ok(a.short.endsWith('…')); assert.equal(a.text, long)
  assert.equal(idealAnswer({ model_answer: 'Short.' }).truncated, false)
  assert.equal(idealAnswer({ model_answer: 'No reference model answer is available for this question yet. x' }).kind, 'unavailable')
  assert.equal(idealAnswer({}).kind, 'none')
})

test('given answer prefers the transcript for spoken answers', () => {
  assert.deepEqual(givenAnswer({ audio_transcript: ' hi ', answer_text: 'x' }), { mode: 'spoken', text: 'hi' })
  assert.deepEqual(givenAnswer({ answer_text: 'typed' }), { mode: 'typed', text: 'typed' })
  assert.equal(givenAnswer(null).mode, 'none')
})

/* ---- signal guide with snapshots ---- */
const cvFull = (o = {}) => ({
  analysisStatus: 'complete', facePresenceRatio: 0.9, facingCameraRatio: 0.8, eyeContactRatio: 0.7,
  headMovement: { level: 'low', yawSpread: 2, pitchSpread: 1 }, expressionVariation: { level: 'moderate' },
  framing: { level: 'good', wellFramedRatio: 0.9, hints: [] }, timeline: { points: [], durationSeconds: 40 },
  snapshots: [
    { t: 0.25, kinds: ['framed', 'facing'], image: 'data:image/jpeg;base64,AAAA' },
    { t: 0.5, kinds: ['away'], image: 'data:image/jpeg;base64,BBBB' },
    { t: 0.75, kinds: ['expressive'], image: 'data:image/jpeg;base64,CCCC' },
  ], ...o,
})

test('guide: one card per measured signal, each with a plain explanation', () => {
  const g = signalGuide(cvFull())
  assert.deepEqual(g.map((c) => c.key), ['presence', 'facing', 'head', 'expression', 'eye', 'framing'])
  assert.ok(g.every((c) => c.means.length > 30 && c.value))
  assert.match(g.find((c) => c.key === 'expression').means, /does not label emotions/)
  assert.match(g.find((c) => c.key === 'framing').means, /nothing about your body posture/)
})

test('guide: a snapshot appears only under the signals it illustrates, with its time in seconds', () => {
  const g = Object.fromEntries(signalGuide(cvFull()).map((c) => [c.key, c]))
  assert.deepEqual(g.facing.shots.map((s) => s.kind), ['facing', 'away'])
  assert.equal(g.facing.shots[0].at, '10s'); assert.equal(g.facing.shots[1].at, '20s')
  assert.deepEqual(g.expression.shots.map((s) => s.kind), ['expressive'])   // no "calm" frame was picked, so none is invented
  assert.deepEqual(g.head.shots, [])                                         // no large head turn was captured
  assert.deepEqual(g.framing.shots.map((s) => s.kind), ['framed'])
})

test('guide: older answers without snapshots still get explanations; unmeasured signals get no card', () => {
  const g = signalGuide(cvFull({ snapshots: undefined }))
  assert.equal(g.length, 6); assert.ok(g.every((c) => c.shots.length === 0))
  const noModel = signalGuide({ analysisStatus: 'model_unavailable', facePresenceRatio: 0.8, snapshots: [] })
  assert.deepEqual(noModel.map((c) => c.key), ['presence'])
  assert.deepEqual(signalGuide(null), [])
})

test('guide: malformed snapshot entries are ignored', () => {
  const g = signalGuide(cvFull({ snapshots: [null, { kinds: 'x', image: 'y' }, { t: 0.1, kinds: ['facing'] }, { t: 0.1, kinds: ['facing'], image: 'data:image/jpeg;base64,ZZ' }] }))
  assert.equal(g.find((c) => c.key === 'facing').shots.length, 1)
})

/* ---- answer quality: the backend decides, the dashboard only displays ---- */
const withQuality = (status, extra = {}, scores = {}) => ans({ ...scores, evaluation_meta: { confidence: 'low', confidenceNote: 'because', answerQuality: { status, label: 'ignored-by-tests', reasons: ['Why.'], scoreBasis: 'STAR element coverage', ...extra } } })

test('quality: older answers without the status keep the old behaviour', () => {
  assert.equal(qualityView(ans()), null)
  assert.equal(qualityView(ans({ evaluation_meta: { confidence: 'low' } })), null)
  assert.equal(qualityView(ans({ evaluation_meta: { answerQuality: { status: 'amazing' } } })), null)
  assert.equal(verdict(ans({ technical_score: '90', relevance_score: '90', clarity_score: '90', completeness_score: '90' })).title, 'Strong answer')
  assert.deepEqual(answerScores(ans()).map((s) => s.value), [85, 90, 78, 75])
  assert.ok(answerScores(ans()).every((s) => s.notScored === false))
})

test('quality: a not-evaluable answer shows no score, no ring value and no ranking of its zeros', () => {
  const a = withQuality('not_evaluable', {}, { technical_score: '0.00', relevance_score: '0.00', clarity_score: '0.00', completeness_score: '0.00' })
  const q = qualityView(a)
  assert.equal(q.evaluable, false); assert.equal(q.tone, 'muted')
  assert.ok(answerScores(a).every((s) => s.value === null && s.notScored === true))
  assert.equal(overallScore(a), null)
  const v = verdict(a)
  assert.equal(v.score, null); assert.equal(v.status, 'not_evaluable'); assert.deepEqual(v.notes, [])
  assert.match(v.text, /did not contain enough understandable content/)
})

test('quality: each status gives the headline and tone the backend asked for, and the ring keeps the plain average of the four scores', () => {
  const tones = { too_short: 'warning', off_topic: 'danger', insufficient: 'danger', partial: 'warning', good: 'success', strong: 'success' }
  for (const [status, tone] of Object.entries(tones)) {
    const a = withQuality(status, { label: `Label for ${status}` })
    const v = verdict(a)
    assert.equal(v.title, `Label for ${status}`); assert.equal(v.tone, tone); assert.equal(v.status, status)
    assert.equal(v.score, 82)   // (85 + 90 + 78 + 75) / 4 = 82, exactly what overallScore says, never derived from the status
    assert.equal(v.score, overallScore(a))
  }
})

test('quality: a very short answer gets no strongest/weakest ranking built from rough partial credit', () => {
  assert.deepEqual(verdict(withQuality('too_short')).notes, [])
  assert.equal(verdict(withQuality('partial')).notes.length, 1)
})

test('quality: reasons and basis are exposed; junk reasons are dropped', () => {
  const q = qualityView(withQuality('partial', { reasons: ['ok', 5, null, ''] }))
  assert.deepEqual(q.reasons, ['ok']); assert.equal(q.basis, 'STAR element coverage')
})

test('skipped: shown as "Skipped", not scored, never mistaken for an evaluable zero', () => {
  const a = ans({ technical_score: '0', relevance_score: '0', clarity_score: '0', completeness_score: '0', evaluation_meta: { skipped: true, answerQuality: { status: 'skipped', label: 'Skipped', reasons: ['You chose to skip this question, so it counts as 0.'] } } })
  const q = qualityView(a)
  assert.equal(q.skipped, true); assert.equal(q.evaluable, false); assert.equal(q.label, 'Skipped')
  assert.deepEqual(answerScores(a).map((s) => s.value), [null, null, null, null])
  const v = verdict(a)
  assert.equal(v.title, 'Skipped'); assert.equal(v.score, null)
  assert.equal(qualityView(ans({ evaluation_meta: { answerQuality: { status: 'good', label: 'Good answer' } } })).skipped, false)
})

test('attempts: only shown once a question was answered again; history is tolerant of bad data', () => {
  assert.equal(attemptsView(ans()), null)
  assert.equal(attemptsView(ans({ evaluation_meta: { attemptCount: 1 } })), null)
  const v = attemptsView(ans({ evaluation_meta: { attemptCount: 3, previousAttempts: [{ at: '2026-01-01T00:00:00Z', skipped: true, average: 0, preview: '' }, { skipped: false, average: '41.4', preview: 'first try' }, null, 'junk'] } }))
  assert.equal(v.count, 3)
  assert.deepEqual(v.previous.map((p) => [p.skipped, p.average, p.preview]), [[true, 0, ''], [false, 41, 'first try']])
  assert.equal(attemptsView(ans({ evaluation_meta: { attemptCount: 2 } })).previous.length, 0)
})
