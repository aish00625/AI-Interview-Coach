// Run with:  npm test   (node's built-in runner)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyCameraError, formatDuration, liveStatusRows, qualityTips, mergeEvents, eventLine, eventTitle, filterEvents, cardView, reviewSummary, CATEGORY_META,
} from './faceMonitor.js'
import { createFaceMonitorController, initialState } from './faceMonitorController.js'

/* ---------------------------------------------------------------- camera errors */
test('camera errors map to actionable messages and server statuses', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }).status, 'permission_denied')
  assert.match(classifyCameraError({ name: 'NotAllowedError' }).message, /Allow camera access/)
  assert.equal(classifyCameraError({ name: 'NotFoundError' }).status, 'device_not_found')
  assert.equal(classifyCameraError({ name: 'NotReadableError' }).status, 'device_in_use')
  assert.match(classifyCameraError({ name: 'NotReadableError' }).message, /another app/i)
  assert.equal(classifyCameraError(new Error('weird')).status, 'stream_error')
  assert.equal(classifyCameraError(null).status, 'stream_error')
})

/* ---------------------------------------------------------------- formatting */
test('durations: unknown is a dash, never zero', () => {
  assert.equal(formatDuration(null), '—'); assert.equal(formatDuration(undefined), '—'); assert.equal(formatDuration(-5), '—'); assert.equal(formatDuration(NaN), '—')
  assert.equal(formatDuration(0), '0 s'); assert.equal(formatDuration(12000), '12 s'); assert.equal(formatDuration(185000), '3 min 05 s'); assert.equal(formatDuration(3720000), '1 h 02 min')
})

/* ---------------------------------------------------------------- live status */
const current = (over = {}) => ({
  faceState: 'face_present', faceCount: 1, quality: { usable: true, issues: [], hints: [] },
  headPose: { status: 'ok', yaw: 4.2, pitch: -3.1, roll: 1 }, gaze: { status: 'ok', deviation: 0.12, side: 'centre' }, identity: { status: 'not_configured' }, ...over,
})
const row = (rows, key) => rows.find((r) => r.key === key)

test('live status: face detected, count, pose and gaze are shown when measured', () => {
  const rows = liveStatusRows(current(), {})
  assert.equal(row(rows, 'face').value, 'Detected'); assert.equal(row(rows, 'count').value, '1')
  assert.match(row(rows, 'head').value, /yaw 4°/); assert.match(row(rows, 'gaze').value, /centre, offset 0.12/)
})

test('live status: no face, multiple faces and unusable frames are distinct states', () => {
  assert.equal(row(liveStatusRows(current({ faceState: 'no_face', faceCount: 0 })), 'face').value, 'Not detected')
  assert.equal(row(liveStatusRows(current({ faceCount: 2 })), 'count').tone, 'warning')
  const unusable = liveStatusRows(current({ faceState: 'unusable_frame', faceCount: null }))
  assert.match(row(unusable, 'face').value, /not usable/); assert.equal(row(unusable, 'count').value, '—')
})

test('live status: unavailable and low-confidence values never show numbers or zero', () => {
  const rows = liveStatusRows(current({ headPose: { status: 'unavailable', yaw: null, pitch: null, roll: null, reason: 'needs_landmark_model' }, gaze: { status: 'low_confidence', deviation: 0.7, side: 'left' } }),
    { headPose: { state: 'unavailable', reason: 'needs_landmark_model' } })
  assert.match(row(rows, 'head').value, /Unavailable — Needs the optional face-landmark model/)
  assert.doesNotMatch(row(rows, 'head').value, /0°/)
  assert.match(row(rows, 'gaze').value, /Low confidence, not counted/); assert.doesNotMatch(row(rows, 'gaze').value, /0\.7/)
})

test('live status: identity states are worded as observations, never verdicts', () => {
  assert.match(row(liveStatusRows(current({ identity: { status: 'verified' } })), 'identity').value, /Matches/)
  const failed = row(liveStatusRows(current({ identity: { status: 'verification_failed' } })), 'identity')
  assert.match(failed.value, /not a verdict/); assert.equal(failed.tone, 'warning')
  assert.equal(row(liveStatusRows(current({ identity: { status: 'unavailable' } })), 'identity').value, 'Unavailable for this frame')
  assert.equal(row(liveStatusRows(current()), 'identity').value, 'Not configured')
})

test('live status before any frame says it is waiting, and tips are de-duplicated and capped', () => {
  assert.match(liveStatusRows(null)[0].value, /Waiting/)
  const tips = qualityTips({ quality: { hints: ['Improve front lighting.', 'Improve front lighting.', 'Centre your face.', '', 7, 'a', 'b', 'c'] } })
  assert.equal(tips.length, 4); assert.equal(tips[0], 'Improve front lighting.')
  assert.deepEqual(qualityTips(null), [])
})

/* ---------------------------------------------------------------- events */
const ev = (id, over = {}) => ({ id, type: 'face_absent', category: 'warning', status: 'resolved', startedAt: new Date(1_700_000_000_000 + id * 60000).toISOString(), endedAt: new Date(1_700_000_000_000 + id * 60000 + 20000).toISOString(), durationMs: 20000, confidence: null, explanation: 'No face for 20 s.', ...over })

test('events merge by id, newest first, and updates replace ongoing ones', () => {
  let list = mergeEvents([], [ev(1, { status: 'ongoing', durationMs: null, endedAt: null }), ev(2)])
  assert.deepEqual(list.map((e) => e.id), [2, 1])
  list = mergeEvents(list, [], [ev(1, { status: 'resolved' })])
  assert.equal(list.length, 2); assert.equal(list.find((e) => e.id === 1).status, 'resolved')
})

test('timeline line: ongoing vs resolved, confidence "Not available" when absent, category wording', () => {
  const ongoing = eventLine(ev(1, { status: 'ongoing', durationMs: null, endedAt: null, ongoingForMs: 7000 }))
  assert.equal(ongoing.stateLabel, 'Ongoing'); assert.equal(ongoing.duration, '7 s'); assert.equal(ongoing.confidence, 'Not available')
  const done = eventLine(ev(2, { confidence: 0.82, category: 'review_recommended' }))
  assert.equal(done.stateLabel, 'Resolved'); assert.equal(done.duration, '20 s'); assert.equal(done.confidence, '82%')
  assert.match(done.category.blurb, /Not a finding of misconduct/)
  assert.match(CATEGORY_META.technical_issue.blurb, /Not your behaviour/)
})

test('event titles are friendly and never accusatory; unknown types fall back to readable text', () => {
  assert.equal(eventTitle('face_absent'), 'No face in view')
  assert.equal(eventTitle('something_new'), 'Something new')
  for (const t of ['face_absent', 'multiple_faces', 'gaze_deviation', 'identity_mismatch', 'review_prolonged_absence']) assert.doesNotMatch(eventTitle(t), /cheat|fraud|dishonest|impersonat/i)
})

test('timeline filter by category', () => {
  const list = [ev(1), ev(2, { category: 'technical_issue' }), ev(3, { category: 'review_recommended' })]
  assert.equal(filterEvents(list, 'all').length, 3); assert.deepEqual(filterEvents(list, 'technical_issue').map((e) => e.id), [2])
})

/* ---------------------------------------------------------------- report cards */
test('unmeasured cards show their state in words and no numbers', () => {
  for (const availability of ['unavailable', 'not_configured', 'not_requested', 'insufficient_data']) {
    const v = cardView({ key: 'eyeGaze', label: 'Eye gaze', availability, measured: null, explanation: 'x', limitations: [] })
    assert.equal(v.lines.length, 0); assert.doesNotMatch(v.headline, /\d/); assert.notEqual(v.stateLabel, 'Measured')
  }
  // Even if a stray measured object arrives, a non-measured card must not render numbers.
  const stray = cardView({ key: 'headMovement', label: 'Head', availability: 'unavailable', measured: { events: 0, measuredMs: 0, deviationSharePct: 0 }, explanation: '' })
  assert.doesNotMatch(stray.headline, /0%/)
})

test('measured cards render their numbers for each of the eight cards', () => {
  const m = {
    faceDetection: { framesAnalysed: 10, framesWithFace: 8, framesWithoutFace: 2, framesUnusable: 1, faceVisibleSharePct: 80 },
    multipleFaces: { events: 1, totalMs: 12000, maxFaces: 2 },
    eyeGaze: { events: 0, measuredMs: 60000, offCentreSharePct: 5, lowConfidenceFrames: 3 },
    headMovement: { events: 2, measuredMs: 60000, deviationSharePct: 10 },
    identity: { evaluatedFrames: 10, matchedFrames: 9, notMatchedFrames: 1, unavailableFrames: 0, outcome: 'mixed' },
    faceAbsence: { events: 1, totalAbsentMs: 25000, longestMs: 25000 },
    suspiciousActivity: { observations: 1, warnings: 1, reviewRecommended: 0, technicalIssues: 2 },
    cameraVisibility: { framesUnusable: 1, unusableSharePct: 10, technicalIssues: 1, gapCount: 1, gapMs: 12000 },
  }
  for (const [key, measured] of Object.entries(m)) {
    const v = cardView({ key, label: key, availability: 'measured', measured, explanation: 'e', limitations: [] })
    assert.equal(v.stateLabel, 'Measured'); assert.ok(v.headline && v.headline !== '—', key)
  }
  assert.match(cardView({ key: 'eyeGaze', label: 'g', availability: 'measured', measured: m.eyeGaze, explanation: '' }).lines.join(' '), /3 low-confidence frames not counted/)
  assert.equal(cardView({ key: 'faceAbsence', label: 'a', availability: 'measured', measured: m.faceAbsence, explanation: '' }).headline, '25 s')
})

test('review summary is phrased as a prompt to review, never a verdict', () => {
  assert.match(reviewSummary({ reviewRecommendations: [] }), /No review suggestions/)
  const s = reviewSummary({ reviewRecommendations: [{}, {}] })
  assert.match(s, /2 patterns were flagged/); assert.match(s, /not a finding of misconduct/)
})

/* ---------------------------------------------------------------- controller (fake camera, fake API, manual timers) */
function rig(over = {}) {
  const calls = { submit: 0, status: [], attached: [], stopped: 0 }
  const track = () => { const t = { onended: null, stop() { calls.stopped += 1 } }; return t }
  const makeStream = () => { const t = track(); return { getTracks: () => [t], getVideoTracks: () => [t], _t: t } }
  const timers = []
  const states = []
  const api = {
    submitFrame: async () => { calls.submit += 1; return { session: { id: 5, elapsedMs: 2000 }, newEvents: [ev(calls.submit)], updatedEvents: [] } },
    reportCameraStatus: async (id, status) => { calls.status.push(status); return { session: { id: 5 }, newEvents: [], updatedEvents: [] } },
    ...over.api,
  }
  let stream = null
  const c = createFaceMonitorController({
    api,
    getUserMedia: over.getUserMedia || (async () => { stream = makeStream(); return stream }),
    captureFrame: over.captureFrame || (async () => ({ size: 100 })),
    attachStream: (s) => calls.attached.push(!!s),
    onChange: (s) => states.push(s),
    setTimer: (fn) => { timers.push(fn); return timers.length },
    clearTimer: () => {},
    intervalMs: 2000,
    describeError: (e) => `E:${e.response ? e.response.status : e.message}`,
  })
  return { c, calls, states, getStream: () => stream, runTimer: async () => { const fn = timers.pop(); if (fn) await fn() }, timers }
}

test('permission denied: no frames are sent, the technical status is reported, the message is actionable', async () => {
  const r = rig({ getUserMedia: async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e } })
  const ok = await r.c.start(5, { id: 5 })
  assert.equal(ok, false)
  const s = r.c.getState()
  assert.equal(s.camera.state, 'error'); assert.equal(s.camera.status, 'permission_denied'); assert.match(s.camera.message, /Allow camera access/)
  assert.equal(s.phase, 'stopped'); assert.deepEqual(r.calls.status, ['permission_denied']); assert.equal(r.calls.submit, 0)
})

test('camera unavailable (no device) is reported as device_not_found', async () => {
  const r = rig({ getUserMedia: async () => { const e = new Error('x'); e.name = 'NotFoundError'; throw e } })
  await r.c.start(5, null)
  assert.equal(r.c.getState().camera.status, 'device_not_found'); assert.deepEqual(r.calls.status, ['device_not_found'])
})

test('start, frame upload and stop: frames update the state and events; stop releases every camera track', async () => {
  const r = rig()
  assert.equal(await r.c.start(5, { id: 5 }), true)
  assert.equal(r.c.getState().phase, 'running'); assert.equal(r.c.getState().camera.state, 'live')
  await r.runTimer(); await r.runTimer()
  const s = r.c.getState()
  assert.equal(r.calls.submit, 2); assert.equal(s.framesSent, 2); assert.equal(s.events.length, 2)
  r.c.stop()
  assert.equal(r.calls.stopped, 1); assert.equal(r.c.getState().phase, 'stopped'); assert.equal(r.c.getState().camera.state, 'off'); assert.equal(r.calls.attached.at(-1), false)
  r.c.stop() // idempotent
  assert.equal(r.calls.stopped, 1)
})

test('pause releases the camera and stops capture; resume reopens it and continues', async () => {
  const r = rig()
  await r.c.start(5, { id: 5 })
  await r.c.setPaused(true)
  assert.equal(r.c.getState().phase, 'paused'); assert.equal(r.c.getState().camera.state, 'off'); assert.equal(r.calls.stopped, 1); assert.equal(r.calls.attached.at(-1), false)
  await r.c.tick(); assert.equal(r.calls.submit, 0)
  assert.equal(await r.c.setPaused(false), true)
  assert.equal(r.c.getState().phase, 'running'); assert.equal(r.c.getState().camera.state, 'live')
  await r.c.tick(); assert.equal(r.calls.submit, 1)
})

test('resume with the camera now blocked reports the technical status and does not send frames', async () => {
  let n = 0
  const r = rig({ getUserMedia: async () => { n += 1; if (n === 2) { const e = new Error('x'); e.name = 'NotAllowedError'; throw e } return { getTracks: () => [{ stop() {} }], getVideoTracks: () => [{}] } } })
  await r.c.start(5, { id: 5 })
  await r.c.setPaused(true)
  assert.equal(await r.c.setPaused(false), false)
  assert.equal(r.c.getState().camera.status, 'permission_denied'); assert.ok(r.calls.status.includes('permission_denied'))
  await r.c.tick(); assert.equal(r.calls.submit, 0)
})

test('camera unplugged mid-session: tracks stop, track_ended is reported, no more frames are sent', async () => {
  const r = rig()
  await r.c.start(5, { id: 5 })
  r.getStream()._t.onended()
  await new Promise((res) => setImmediate(res))
  const s = r.c.getState()
  assert.equal(s.camera.state, 'error'); assert.equal(s.camera.status, 'track_ended'); assert.deepEqual(r.calls.status, ['track_ended'])
  await r.c.tick(); assert.equal(r.calls.submit, 0)
})

test('restart camera after a failure resumes capture in the same session', async () => {
  let first = true
  const r = rig({ getUserMedia: async () => { if (first) { first = false; const e = new Error('x'); e.name = 'NotReadableError'; throw e } return { getTracks: () => [{ stop() {} }], getVideoTracks: () => [{}] } } })
  assert.equal(await r.c.start(5, null), false)
  assert.equal(r.c.getState().camera.status, 'device_in_use')
  assert.equal(await r.c.restartCamera(), true)
  assert.equal(r.c.getState().camera.state, 'live'); assert.equal(r.c.getState().phase, 'running')
})

test('a failed capture is reported once as capture_failed, not once per frame, and nothing is uploaded', async () => {
  const r = rig({ captureFrame: async () => null })
  await r.c.start(5, { id: 5 })
  await r.runTimer(); await r.runTimer(); await r.runTimer()
  assert.deepEqual(r.calls.status, ['capture_failed']); assert.equal(r.calls.submit, 0)
})

test('API error on a frame is shown as a service problem and capture keeps going; it is not treated as behaviour', async () => {
  let n = 0
  const r = rig({ api: { submitFrame: async () => { n += 1; if (n === 1) { const e = new Error('x'); e.response = { status: 503, data: { reason: 'ai_service_unreachable' } }; throw e } return { session: { id: 5 }, newEvents: [], updatedEvents: [] } } } })
  await r.c.start(5, { id: 5 })
  await r.runTimer()
  let s = r.c.getState()
  assert.equal(s.serviceTrouble, true); assert.equal(s.lastError, 'E:503'); assert.equal(s.phase, 'running'); assert.equal(s.events.length, 0)
  await r.runTimer()
  s = r.c.getState()
  assert.equal(s.serviceTrouble, false); assert.equal(s.lastError, ''); assert.equal(s.framesSent, 1)
})

test('409 from the server (session ended or paused elsewhere) stops the loop and releases the camera', async () => {
  const r = rig({ api: { submitFrame: async () => { const e = new Error('x'); e.response = { status: 409, data: {} }; throw e } } })
  await r.c.start(5, { id: 5 })
  await r.runTimer()
  const s = r.c.getState()
  assert.equal(s.phase, 'stopped'); assert.equal(s.ended, true); assert.equal(r.calls.stopped, 1)
})

test('initial state is empty and idle', () => {
  const s = initialState()
  assert.equal(s.phase, 'idle'); assert.deepEqual(s.events, []); assert.equal(s.session, null)
})

/* ---------------------------------------------------------------- STAR applicability */
import { shouldOfferStar, isPastExperienceQuestion } from './starApplicability.js'

test('STAR is never offered for technical interviews and always for behavioural / HR ones', () => {
  assert.equal(shouldOfferStar('technical', 'Tell me about a time you fixed a bug'), false)
  assert.equal(shouldOfferStar('behavioral', 'What motivates you?'), true)
  assert.equal(shouldOfferStar('hr', 'Why this company?'), true)
})

test('in a mixed interview STAR is offered only for questions that ask for a past experience', () => {
  assert.equal(shouldOfferStar('mixed', 'Explain the difference between method overloading and method overriding.'), false)
  assert.equal(shouldOfferStar('mixed', 'What is the difference between a primary key and a foreign key?'), false)
  assert.equal(shouldOfferStar('mixed', 'Tell me about a time you disagreed with a teammate.'), true)
  assert.equal(shouldOfferStar('mixed', 'How did you handle a tight deadline?'), true)
  assert.equal(shouldOfferStar('mixed', 'Describe a project where you used SQL.'), true)
  assert.equal(isPastExperienceQuestion(''), false); assert.equal(isPastExperienceQuestion(null), false)
})
