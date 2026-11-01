// Face-monitoring timing engine: pure logic, no database or AI service.
const test = require('node:test')
const assert = require('node:assert/strict')
const E = require('../../utils/faceMonitorEngine')

const cfg = E.DEFAULT_CONFIG
const base = {
  faceState: 'face_present', faceCount: 1, quality: { usable: true, issues: [], hints: [] },
  headPose: { status: 'ok', yaw: 0, pitch: 0, roll: 0 }, gaze: { status: 'ok', deviation: 0.05, side: 'centre' },
  identity: { status: 'not_configured' }, detector: 'fake',
}
const mk = (over = {}) => E.normalizeObservation({ ...base, ...over })
const present = (over) => mk(over)
const absent = () => mk({ faceState: 'no_face', faceCount: 0, headPose: { status: 'unavailable' }, gaze: { status: 'unavailable' } })
const unusable = () => mk({ faceState: 'unusable_frame', faceCount: null, quality: { usable: false, issues: ['too_dark'], hints: ['improve_lighting'] }, headPose: { status: 'unavailable' }, gaze: { status: 'unavailable' } })

/** Runs frames [obs, ...] every 2 s from t=0 the way the service does (assigning event ids), returning all changes. */
function run(frames, { start = E.initState(0), every = 2000, from = 0 } = {}) {
  let state = start
  const all = []
  let id = 100
  frames.forEach((obs, i) => {
    const r = E.step(state, obs, from + i * every, cfg)
    for (const c of r.changes) {
      if (c.op === 'open') r.state.tracks[c.track].eventId = ++id
      all.push(c)
    }
    state = r.state
  })
  return { state, changes: all }
}
const rep = (obs, n) => Array.from({ length: n }, () => obs)
const ops = (changes, op, track) => changes.filter((c) => c.op === op && (!track || c.track === track))

test('a brief loss of the face (under the threshold) is not an event', () => {
  const { changes, state } = run([present(), ...rep(absent(), 3), present()])
  assert.equal(changes.filter((c) => c.track === 'absence').length, 0)
  assert.equal(state.tracks.absence.runStart, null)
})

test('prolonged absence becomes ONE event: observation, escalating to warning, closed when the face returns', () => {
  const { changes } = run([present(), ...rep(absent(), 10), present()])
  assert.equal(ops(changes, 'open', 'absence').length, 1, 'one event for one continuous absence')
  const open = ops(changes, 'open', 'absence')[0]
  assert.equal(open.category, 'observation')
  assert.equal(open.startedAt, 2000)
  assert.equal(ops(changes, 'update', 'absence')[0].category, 'warning')
  const close = ops(changes, 'close', 'absence')[0]
  assert.equal(close.eventId, 101)
  assert.equal(close.durationMs, 20000 - 2000)  // first absent frame at 2 s, last at 20 s
  assert.match(close.explanation, /not a finding of misconduct/)
})

test('dark / unreadable frames are never counted as absence', () => {
  const { changes, state } = run([present(), ...rep(unusable(), 15)])
  assert.equal(ops(changes, 'open', 'absence').length, 0)
  assert.equal(state.totals.faceAbsentMs, 0)
  assert.ok(state.totals.unusableMs > 0)
  const q = ops(changes, 'open', 'quality')
  assert.equal(q.length, 1)
  assert.equal(q[0].category, 'technical_issue')
})

test('unknown frames inside an absence do not extend it forever; the run is closed after the continuity window', () => {
  const { changes } = run([present(), ...rep(absent(), 5), ...rep(unusable(), 8)])
  assert.equal(ops(changes, 'open', 'absence').length, 1)
  assert.equal(ops(changes, 'close', 'absence').length, 1)
})

test('multiple faces: a single frame is nothing, a sustained run is one event with the peak count', () => {
  assert.equal(ops(run([present(), present({ faceCount: 2 }), present()]).changes, 'open', 'multiFace').length, 0)
  const { changes } = run([present(), ...rep(present({ faceCount: 2 }), 3), present({ faceCount: 3 }), present({ faceCount: 3 }), present()])
  const open = ops(changes, 'open', 'multiFace')
  assert.equal(open.length, 1)
  const close = ops(changes, 'close', 'multiFace')[0]
  assert.match(close.explanation, /3 faces/)
})

test('head pose: only sustained deviation counts; low-confidence pose is unknown, not zero', () => {
  const turned = present({ headPose: { status: 'ok', yaw: 45, pitch: 0, roll: 0 } })
  assert.equal(ops(run([present(), turned, present()]).changes, 'open', 'head').length, 0, 'one turn to think is not an event')
  const { changes, state } = run(rep(turned, 5))
  assert.equal(ops(changes, 'open', 'head').length, 1)
  assert.ok(state.totals.headDeviationMs > 0)
  const lowConf = run(rep(present({ headPose: { status: 'low_confidence', yaw: 80, pitch: 0, roll: 0 } }), 10))
  assert.equal(lowConf.state.totals.headEvaluatedMs, 0)
  assert.equal(ops(lowConf.changes, 'open', 'head').length, 0)
})

test('looking down (pitch) is measured separately from sideways turns', () => {
  const down = present({ headPose: { status: 'ok', yaw: 0, pitch: -40, roll: 0 } })
  assert.equal(ops(run(rep(down, 5)).changes, 'open', 'head').length, 1)
})

test('gaze: reliable deviation over time is one event; low-confidence/unavailable gaze never creates one', () => {
  const off = present({ gaze: { status: 'ok', deviation: 0.8, side: 'right' } })
  assert.equal(ops(run(rep(off, 5)).changes, 'open', 'gaze').length, 1)
  assert.equal(ops(run([present(), off, present()]).changes, 'open', 'gaze').length, 0, 'a single glance is not an event')
  const low = run(rep(present({ gaze: { status: 'low_confidence', deviation: null, reason: 'head_turned_too_far' } }), 10))
  assert.equal(ops(low.changes, 'open', 'gaze').length, 0)
  assert.equal(low.state.totals.gazeEvaluatedMs, 0)
  assert.equal(low.state.totals.gazeLowConfidenceFrames, 10)
})

test('identity: ignored unless requested; failures need to persist; unavailable checks are not failures', () => {
  const fail = present({ identity: { status: 'verification_failed', similarity: 0.1 } })
  assert.equal(ops(run(rep(fail, 6)).changes, 'open', 'identity').length, 0, 'not requested')
  const requested = E.initState(0, true)
  const r = run(rep(fail, 6), { start: requested })
  const open = ops(r.changes, 'open', 'identity')
  assert.equal(open.length, 1)
  assert.equal(open[0].category, 'warning')
  assert.match(open[0].explanation, /does not establish who is present/)
  const unavailable = run(rep(present({ identity: { status: 'unavailable', reason: 'poor_image_quality' } }), 10), { start: requested })
  assert.equal(unavailable.state.totals.identityFailed, 0)
  assert.equal(ops(unavailable.changes, 'open', 'identity').length, 0)
})

test('a long silence between frames is a monitoring gap (technical), not absence, and cuts open runs', () => {
  let s = run([present(), ...rep(absent(), 5)]).state
  const r = E.step(s, present(), 60000, cfg)
  const gap = r.changes.find((c) => c.eventType === 'monitoring_gap')
  assert.ok(gap)
  assert.equal(gap.category, 'technical_issue')
  assert.equal(r.state.totals.gapCount, 1)
  assert.ok(r.changes.some((c) => c.op === 'close' && c.track === 'absence'))
  assert.equal(r.state.totals.faceAbsentMs, 10000, 'the 50 s gap is not credited to absence (only the five 2 s intervals before it)')
})

test('camera problems are technical issues that cut behaviour runs and end when frames resume', () => {
  let s = run([present(), ...rep(absent(), 4)]).state
  const c = E.cameraIssue(s, 'track_ended', 10000, cfg)
  assert.equal(c.changes.find((x) => x.op === 'open').category, 'technical_issue')
  assert.ok(c.changes.some((x) => x.op === 'close' && x.track === 'absence'))
  c.state.tracks.camera.eventId = 7
  const r = E.step(c.state, present(), 40000, cfg)
  assert.ok(r.changes.some((x) => x.op === 'close' && x.track === 'camera' && x.eventId === 7))
  assert.ok(!r.changes.some((x) => x.eventType === 'monitoring_gap'), 'the outage is already a technical event')
  assert.throws(() => E.cameraIssue(s, 'not_a_kind', 1, cfg))
})

test('service outage is a technical issue, never behaviour', () => {
  const s = run([present()]).state
  const p = E.processingIssue(s, 'ai_service_timeout', 5000, cfg)
  assert.equal(p.changes[0].eventType, 'analysis_unavailable')
  assert.equal(p.changes[0].category, 'technical_issue')
})

test('stale or duplicate-time frames are ignored and input state is never mutated', () => {
  const s = run([present(), present()]).state
  const before = JSON.stringify(s)
  const r = E.step(s, absent(), 1000, cfg)
  assert.equal(r.stale, true)
  assert.equal(JSON.stringify(s), before)
  const r2 = E.step(s, absent(), 20000, cfg)
  assert.equal(JSON.stringify(s), before)
  assert.notEqual(r2.state, s)
})

test('pause closes runs and resume does not invent a gap or credit paused time', () => {
  const s = run([present(), ...rep(absent(), 5)]).state
  const p = E.pause(s, 12000, cfg)
  assert.ok(p.changes.some((c) => c.op === 'close' && c.track === 'absence'))
  const r = E.resume(p.state, 612000)
  assert.equal(r.pausedMs, 600000)
  const f = E.step(r.state, present(), 614000, cfg)
  assert.ok(!f.changes.some((c) => c.eventType === 'monitoring_gap'))
  assert.equal(f.state.totals.monitoredMs, s.totals.monitoredMs)
})

test('end closes every open run', () => {
  const s = run([present(), ...rep(absent(), 5)]).state
  const e = E.end(s, 20000, cfg)
  assert.equal(e.changes.filter((c) => c.op === 'close' && c.track === 'absence').length, 1)
})

test('review recommendations fire once, with evidence, and never for thin data', () => {
  // three separate multi-face periods
  let frames = []
  for (let i = 0; i < 3; i++) frames = frames.concat(rep(present({ faceCount: 2 }), 4), rep(present(), 3))
  const { changes } = run(frames)
  const review = changes.filter((c) => c.category === 'review_recommended')
  assert.equal(review.length, 1)
  assert.equal(review[0].eventType, 'review_repeated_multiple_faces')
  assert.ok(review[0].evidence.events >= 3)
  assert.match(review[0].explanation, /not a finding of misconduct/)
  // one long absence
  const long = run([present(), ...rep(absent(), 30)])
  assert.equal(long.changes.filter((c) => c.eventType === 'review_prolonged_absence').length, 1)
  // a few seconds of head turning in a short session recommends nothing
  const thin = run([present(), ...rep(present({ headPose: { status: 'ok', yaw: 50, pitch: 0, roll: 0 } }), 5)])
  assert.equal(thin.changes.filter((c) => c.category === 'review_recommended').length, 0)
})

test('head-turn share rule needs enough measured time', () => {
  const turned = present({ headPose: { status: 'ok', yaw: 50, pitch: 0, roll: 0 } })
  const { changes } = run([present(), ...rep(turned, 40)])
  assert.equal(changes.filter((c) => c.eventType === 'review_frequent_head_deviation').length, 1)
})

test('normalizeObservation rejects untrusted shapes and sanitises fields', () => {
  assert.throws(() => E.normalizeObservation(null))
  assert.throws(() => E.normalizeObservation({ faceState: 'cheating' }))
  const o = E.normalizeObservation({ faceState: 'face_present', faceCount: 999, headPose: { status: 'weird', yaw: 'x' }, gaze: { status: 'ok', deviation: NaN } })
  assert.equal(o.faceCount, 20)
  assert.equal(o.headPose.status, 'unavailable')
  assert.equal(o.headPose.yaw, null)
  assert.equal(o.gaze.deviation, null)
  assert.equal(E.normalizeObservation({ faceState: 'unusable_frame', faceCount: 3 }).faceCount, null)
})

test('loadConfig: defaults, valid overrides, invalid values warned and ignored', () => {
  assert.deepEqual(E.loadConfig({}).config, E.DEFAULT_CONFIG)
  const ok = E.loadConfig({ FACE_ABSENCE_SEC: '8', FACE_HEAD_YAW_DEG: '35' })
  assert.equal(ok.config.absence.observationMs, 8000)
  assert.equal(ok.config.head.yawDeg, 35)
  const bad = E.loadConfig({ FACE_ABSENCE_SEC: '0', FACE_GAZE_DEVIATION: 'abc' })
  assert.equal(bad.config.absence.observationMs, 5000)
  assert.equal(bad.warnings.length, 2)
})

test('report: measured values, unavailable features stay unavailable, thin data is insufficient', () => {
  const noModel = { headPose: { status: 'unavailable', reason: 'needs_landmark_model' }, gaze: { status: 'unavailable', reason: 'needs_landmark_model' } }
  const { state, changes } = run([present(noModel), ...rep(absent(), 10), ...rep(present(noModel), 20)])
  const events = changes.filter((c) => c.op === 'open').map((c, i) => ({ id: i, eventType: c.eventType, category: c.category, startedAt: c.startedAt, endedAt: 99000, durationMs: 16000, explanation: c.explanation, evidence: c.evidence }))
  const features = { faceDetection: { state: 'available' }, headPose: { state: 'unavailable', reason: 'needs_landmark_model' }, gaze: { state: 'unavailable', reason: 'needs_landmark_model' }, identity: { state: 'not_configured' } }
  const r = E.buildReport({ startedAt: 0, endedAt: 100000, state, events, config: cfg, features, identityRequested: false })
  const card = (k) => r.cards.find((c) => c.key === k)
  assert.equal(r.cards.length, 8)
  assert.equal(card('eyeGaze').availability, 'unavailable')
  assert.equal(card('eyeGaze').measured, null)
  assert.equal(card('headMovement').availability, 'unavailable')
  assert.equal(card('identity').availability, 'not_configured')
  assert.equal(card('faceAbsence').measured.totalAbsentMs > 0, true)
  assert.ok(r.notices.some((n) => /not part of any interview or coding score/.test(n)))
  const empty = E.buildReport({ startedAt: 0, endedAt: 1, state: E.initState(0), events: [], config: cfg, features, identityRequested: false })
  assert.equal(empty.cards.find((c) => c.key === 'faceDetection').availability, 'insufficient_data')
  assert.equal(empty.cards.find((c) => c.key === 'faceDetection').measured, null)
  assert.ok(empty.limitations.some((l) => /30 seconds/.test(l)))
})
