const crypto = require('crypto')
const { pool } = require('../config/db')
const model = require('../models/faceMonitorModel')
const interviewModel = require('../models/interviewModel')
const ai = require('./aiServiceClient')
const engine = require('../utils/faceMonitorEngine')

/**
 * Optional, consent-based Face Monitoring for PRACTICE sessions.
 *
 * Boundaries (enforced here, covered by tests):
 *  - identity always comes from the verified JWT; every query is scoped to that user (another candidate's session is a 404)
 *  - the client sends frames and enumerated camera statuses only. It never sends scores, severities, timings, event
 *    categories or verification results: those are computed here from the AI service's measurements and SERVER time
 *  - no frame, image, template or embedding is stored; frames live in memory for one request
 *  - nothing here touches interview scores, coding results or hirer data
 */
const CONSENT_VERSION = '2026-10-v1'
// face_monitoring_sessions.consent_version is VARCHAR(20): keep every version string at 20 characters or fewer.
const ASSESSMENT_CONSENT_VERSION = 'assess-2026-10-v1'
const FRAME_INTERVAL_MS = 2000

const httpError = (statusCode, message, reason, retryable = false) => {
  const err = new Error(message)
  err.statusCode = statusCode
  err.reason = reason
  err.retryable = retryable
  return err
}
const notFound = () => httpError(404, 'Monitoring session not found.', 'not_found')

function retentionDays() {
  const n = Number(process.env.FACE_MONITOR_RETENTION_DAYS)
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30
}

/** What the candidate is told before any camera access, kept next to the code that implements it. */
function privacyNotice() {
  return {
    consentVersion: CONSENT_VERSION,
    runs: [
      'Face detection and face count',
      'Image quality (lighting, sharpness, framing)',
      'Head direction, when the optional face model is installed',
      'A rough horizontal gaze estimate, when the optional face model is installed',
      'Time with no face in view',
      'An optional same-person check against a photo taken at the start, only if you separately agree and the optional recognition model is installed',
    ],
    stored: [
      'Start and end times, durations, and short event descriptions with the measurements behind them',
      'Which features were available and the thresholds used',
      'No video, no images, no face templates or embeddings are stored. A frame is analysed in memory and discarded.',
    ],
    notStored: ['Video', 'Images', 'Face templates or embeddings', 'Audio', 'Keystrokes'],
    retentionDays: retentionDays(),
    notes: [
      'Events are observations, not a finding of misconduct. Nothing here disqualifies you or changes any interview or coding score.',
      'It does not read emotion, honesty, attention or intent.',
      'You can pause, stop, or delete a session and its data at any time.',
      'Only you can see your reports.',
    ],
  }
}

/**
 * The notice shown before monitoring a hirer ASSESSMENT (migration 018). Unlike practice, the hiring team can see the events,
 * so it says so, and it states that nothing here changes a score or decides anything automatically.
 */
function assessmentPrivacyNotice() {
  const base = privacyNotice()
  return {
    ...base,
    consentVersion: ASSESSMENT_CONSENT_VERSION,
    notes: [
      'The hiring team for this assessment can see the timestamped events and the measurements behind them. They cannot see video or images, because none are kept.',
      'Events are observations, not a finding of misconduct. Looking away, head movement, lighting changes and camera interruptions have many innocent causes.',
      'Monitoring never changes your score, never ranks you, and never rejects you automatically. People make every hiring decision.',
      'It does not read emotion, personality, confidence, honesty or intent.',
      'If you cannot or prefer not to use a camera, choose the alternative option; the hiring team is told only that you chose it.',
      'Monitoring records for an assessment cannot be deleted from your account while they may be reviewed; they are removed when the retention period ends.',
    ],
  }
}

async function getCapabilities() {
  const caps = await ai.getFaceMonitorCapabilities()
  const { config, warnings } = engine.loadConfig()
  const fm = caps.faceMonitor || null
  return {
    service: { reachable: caps.reachable, reason: caps.reason || null },
    available: !!(fm && fm.available),
    state: fm ? fm.state : 'unavailable',
    message: fm ? fm.message : (caps.reachable ? 'The AI service does not support face monitoring (update it).' : 'The AI service could not be reached.'),
    features: fm ? fm.features : null,
    frameIntervalMs: FRAME_INTERVAL_MS,
    thresholds: {
      absenceMs: config.absence.observationMs, multiFaceMs: config.multiFace.observationMs,
      headYawDeg: config.head.yawDeg, headPitchDeg: config.head.pitchDeg, headMs: config.head.observationMs,
      gazeDeviation: config.gaze.deviation, gazeMs: config.gaze.observationMs,
    },
    configWarnings: warnings,
    privacy: privacyNotice(),
  }
}

function featureMap(fm) {
  const f = (fm && fm.features) || {}
  const st = (ok, reason) => (ok ? { state: 'available' } : { state: 'unavailable', reason })
  return {
    faceDetection: st(f.faceDetection, 'face_analysis_unavailable'),
    multipleFaces: st(f.multipleFaces, 'face_analysis_unavailable'),
    imageQuality: st(f.imageQuality, 'face_analysis_unavailable'),
    headPose: st(f.headPose, 'needs_landmark_model'),
    gaze: st(f.gaze, 'needs_landmark_model'),
    identity: f.identity ? { state: 'available' } : { state: 'not_configured', reason: 'needs_recognition_model' },
  }
}

const toMs = (v) => new Date(v).getTime()

function elapsedMs(session, now) {
  const endOrNow = session.endedAt ? toMs(session.endedAt) : now
  let paused = session.pausedMs
  const st = session.engineState
  if (!session.endedAt && st && st.pausedAt != null) paused += Math.max(0, now - st.pausedAt)
  return Math.max(0, endOrNow - toMs(session.startedAt) - paused)
}

function publicSession(session, now = Date.now()) {
  const st = session.engineState || {}
  return {
    id: session.id, status: session.status, interviewSessionId: session.interviewSessionId, assessmentAttemptId: session.assessmentAttemptId ?? null,
    startedAt: session.startedAt, endedAt: session.endedAt, elapsedMs: elapsedMs(session, now),
    consentVersion: session.consentVersion, identity: { requested: session.identityConsent, status: session.identityStatus },
    features: session.features, thresholds: session.config, retentionUntil: session.retentionUntil,
    current: st.last || null,
    totals: st.totals ? {
      framesAnalysed: st.totals.framesTotal, framesWithFace: st.totals.framesFacePresent, framesWithoutFace: st.totals.framesNoFace, framesUnusable: st.totals.framesUnusable,
      faceVisibleMs: st.totals.faceVisibleMs, faceAbsentMs: st.totals.faceAbsentMs, maxFaces: st.totals.maxFaces || null,
    } : null,
  }
}

const publicEvent = (e, now = Date.now()) => ({
  id: e.id, type: e.eventType, category: e.category, status: e.status, startedAt: e.startedAt, endedAt: e.endedAt,
  durationMs: e.durationMs, ongoingForMs: e.status === 'ongoing' ? Math.max(0, now - toMs(e.startedAt)) : null,
  confidence: e.confidence, explanation: e.explanation, evidence: e.evidence,
  requiresReview: e.category === 'review_recommended',
})

/** Applies the engine's changes to the events table inside the caller's transaction and records new event ids in the state. */
async function applyChanges(db, session, state, changes) {
  const opened = []
  const updated = []
  for (const c of changes) {
    if (c.op === 'open') {
      const ev = await model.insertEvent(db, {
        sessionId: session.id, userId: session.userId, eventType: c.eventType, category: c.category, status: 'ongoing',
        startedAt: c.startedAt, endedAt: null, durationMs: null, confidence: c.confidence, explanation: c.explanation, evidence: c.evidence,
      })
      state.tracks[c.track].eventId = ev.id
      opened.push(ev)
    } else if (c.op === 'instant') {
      const ev = await model.insertEvent(db, {
        sessionId: session.id, userId: session.userId, eventType: c.eventType, category: c.category, status: 'resolved',
        startedAt: c.startedAt, endedAt: c.endedAt, durationMs: Math.max(0, c.endedAt - c.startedAt), confidence: c.confidence, explanation: c.explanation, evidence: c.evidence,
      })
      opened.push(ev)
    } else if ((c.op === 'update' || c.op === 'close') && c.eventId) {
      const ev = await model.updateEvent(db, c.eventId, session.id, session.userId, {
        category: c.category, explanation: c.explanation, resolved: c.op === 'close', endedAt: c.endedAt, durationMs: c.durationMs,
      })
      if (ev) updated.push(ev)
    }
  }
  return { opened, updated }
}

async function inTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* keep the original error */ }
    throw err
  } finally {
    client.release()
  }
}

/* ------------------------------------------------------------------ sessions */
async function createSession({ userId, consent, identityConsent = false, interviewSessionId = null, assessmentAttemptId = null }) {
  if (consent !== true) throw httpError(400, 'You must agree to camera-based analysis before it can start.', 'consent_required')
  // assessmentAttemptId is set only by assessmentAttemptService after it has checked ownership, status and consent; the
  // practice route never passes it. Assessment sessions never use the optional same-person check.
  if (assessmentAttemptId != null) identityConsent = false

  if (interviewSessionId != null) {
    const s = await interviewModel.getSessionById(interviewSessionId)
    if (!s || s.user_id !== userId) throw httpError(404, 'Interview session not found.', 'not_found')
    if (s.application_id) throw httpError(400, 'Face monitoring is only available for practice interviews.', 'practice_only')
  }

  const caps = await ai.getFaceMonitorCapabilities()
  if (!caps.reachable) throw httpError(503, 'The AI service could not be reached, so face monitoring cannot start. Check that it is running.', caps.reason || 'ai_service_unreachable', true)
  if (!caps.faceMonitor || !caps.faceMonitor.available) {
    throw httpError(503, (caps.faceMonitor && caps.faceMonitor.message) || 'Face monitoring is not available on the AI service (OpenCV is missing or the service needs an update).', 'face_monitor_unavailable', false)
  }
  const features = featureMap(caps.faceMonitor)
  const identityRequested = !!identityConsent && features.identity.state === 'available'
  const { config } = engine.loadConfig()
  const referenceKey = identityRequested ? crypto.randomBytes(16).toString('hex') : null
  const now = Date.now()

  // Retention housekeeping, and release any in-memory references that belonged to the rows being removed.
  try { (await model.purgeExpired(pool)).forEach((k) => ai.deleteFaceReference(k)) } catch { /* housekeeping must never block a session */ }

  try {
    const session = await model.createSession(pool, {
      userId, interviewSessionId, assessmentAttemptId, consentVersion: assessmentAttemptId != null ? ASSESSMENT_CONSENT_VERSION : CONSENT_VERSION, identityConsent: !!identityConsent,
      identityStatus: identityConsent ? (identityRequested ? 'awaiting_reference' : 'not_configured') : 'not_requested',
      referenceKey, features, config, engineState: engine.initState(now, identityRequested), retentionDays: retentionDays(),
    })
    return { session: publicSession(session, now), frameIntervalMs: FRAME_INTERVAL_MS }
  } catch (err) {
    if (err && err.code === '23505') {
      const running = await model.getRunning(pool, userId)
      const e = httpError(409, 'You already have a running monitoring session. Resume or end it first.', 'session_already_running')
      e.sessionId = running ? running.id : null
      throw e
    }
    throw err
  }
}

async function loadOwned(db, id, userId, opts) {
  const s = await model.getOwned(db, id, userId, opts)
  if (!s) throw notFound()
  return s
}

async function getSession({ userId, sessionId }) {
  const s = await loadOwned(pool, sessionId, userId)
  const events = await model.listEvents(pool, sessionId, userId)
  const now = Date.now()
  return { session: publicSession(s, now), events: events.map((e) => publicEvent(e, now)) }
}

async function listSessions({ userId }) {
  return { sessions: await model.listForUser(pool, userId) }
}

/* ------------------------------------------------------------------ frames */
async function submitFrame({ userId, sessionId, frameBuffer, mimeType, receivedAt = Date.now() }) {
  const session = await loadOwned(pool, sessionId, userId)
  if (session.status !== 'active') throw httpError(409, session.status === 'paused' ? 'Monitoring is paused. Resume it to continue.' : 'This monitoring session has ended.', `session_${session.status}`)

  let raw
  try {
    raw = await ai.analyzeFaceFrame({ frameBuffer, mimeType, referenceKey: session.identityConsent ? session.referenceKey : null })
  } catch (err) {
    // The frame could not be analysed. That is a technical problem to record, not behaviour.
    const kind = err.statusCode === 422 ? 'capture_failed' : null
    await recordTechnical({ userId, sessionId, receivedAt, kind, reason: err.reason || 'ai_error' }).catch(() => {})
    throw err
  }

  let obs
  try {
    obs = engine.normalizeObservation(raw)
  } catch {
    await recordTechnical({ userId, sessionId, receivedAt, kind: null, reason: 'ai_invalid_response' }).catch(() => {})
    throw httpError(503, 'The face analysis service returned an unexpected response.', 'ai_invalid_response', false)
  }

  return inTransaction(async (db) => {
    const locked = await loadOwned(db, sessionId, userId, { forUpdate: true })
    if (locked.status !== 'active') throw httpError(409, 'Monitoring is no longer active.', `session_${locked.status}`)
    const r = engine.step(locked.engineState, obs, receivedAt, locked.config)
    if (r.stale) return { stale: true, session: publicSession(locked, receivedAt), newEvents: [], updatedEvents: [] }
    const { opened, updated } = await applyChanges(db, locked, r.state, r.changes)
    const saved = await model.saveState(db, sessionId, userId, r.state)
    return { stale: false, session: publicSession(saved, receivedAt), newEvents: opened.map((e) => publicEvent(e, receivedAt)), updatedEvents: updated.map((e) => publicEvent(e, receivedAt)) }
  })
}

/** Camera/service problems become technical events; the engine cuts behaviour runs so outages are never read as absence. */
async function recordTechnical({ userId, sessionId, receivedAt, kind, reason }) {
  return inTransaction(async (db) => {
    const s = await loadOwned(db, sessionId, userId, { forUpdate: true })
    if (s.status !== 'active') return null
    const r = kind ? engine.cameraIssue(s.engineState, kind, receivedAt, s.config) : engine.processingIssue(s.engineState, reason, receivedAt, s.config)
    const { opened, updated } = await applyChanges(db, s, r.state, r.changes)
    const saved = await model.saveState(db, sessionId, userId, r.state)
    return { session: publicSession(saved, receivedAt), newEvents: opened.map((e) => publicEvent(e, receivedAt)), updatedEvents: updated.map((e) => publicEvent(e, receivedAt)) }
  })
}

async function reportCameraStatus({ userId, sessionId, status }) {
  if (!Object.prototype.hasOwnProperty.call(engine.CAMERA_KINDS, status)) throw httpError(400, 'Unknown camera status.', 'bad_camera_status')
  const s = await loadOwned(pool, sessionId, userId)
  if (s.status !== 'active') throw httpError(409, 'Monitoring is not active.', `session_${s.status}`)
  const out = await recordTechnical({ userId, sessionId, receivedAt: Date.now(), kind: status })
  return out || { session: publicSession(s), newEvents: [], updatedEvents: [] }
}

/* ------------------------------------------------------------------ identity reference */
async function captureReference({ userId, sessionId, frameBuffer, mimeType }) {
  const s = await loadOwned(pool, sessionId, userId)
  if (s.status !== 'active') throw httpError(409, 'Monitoring is not active.', `session_${s.status}`)
  if (!s.identityConsent || !s.referenceKey) throw httpError(400, 'The same-person check was not requested or is not available for this session.', 'identity_not_requested')
  const res = await ai.storeFaceReference({ frameBuffer, mimeType, referenceKey: s.referenceKey })
  if (!res || typeof res.status !== 'string') throw httpError(503, 'The face analysis service returned an unexpected response.', 'ai_invalid_response')
  const status = res.status === 'stored' ? 'reference_stored' : res.status === 'not_configured' ? 'not_configured' : s.identityStatus
  if (status !== s.identityStatus) await model.saveState(pool, sessionId, userId, s.engineState, { identityStatus: status })
  return { status: res.status === 'stored' ? 'stored' : res.status === 'not_configured' ? 'not_configured' : 'rejected', reason: typeof res.reason === 'string' ? res.reason.slice(0, 60) : null }
}

/* ------------------------------------------------------------------ lifecycle */
async function pauseSession({ userId, sessionId }) {
  return inTransaction(async (db) => {
    const s = await loadOwned(db, sessionId, userId, { forUpdate: true })
    if (s.status !== 'active') throw httpError(409, 'Only an active session can be paused.', `session_${s.status}`)
    const now = Date.now()
    const r = engine.pause(s.engineState, now, s.config)
    const { opened, updated } = await applyChanges(db, s, r.state, r.changes)
    const saved = await model.saveState(db, sessionId, userId, r.state, { status: 'paused' })
    return { session: publicSession(saved, now), newEvents: opened.map((e) => publicEvent(e, now)), updatedEvents: updated.map((e) => publicEvent(e, now)) }
  })
}

async function resumeSession({ userId, sessionId }) {
  return inTransaction(async (db) => {
    const s = await loadOwned(db, sessionId, userId, { forUpdate: true })
    if (s.status !== 'paused') throw httpError(409, 'Only a paused session can be resumed.', `session_${s.status}`)
    const running = await model.getRunning(db, userId)
    if (running && running.id !== s.id) throw httpError(409, 'Another monitoring session is running.', 'session_already_running')
    const now = Date.now()
    const r = engine.resume(s.engineState, now)
    const saved = await model.saveState(db, sessionId, userId, r.state, { status: 'active', pausedMsAdd: r.pausedMs })
    return { session: publicSession(saved, now), newEvents: [], updatedEvents: [] }
  })
}

async function endSession({ userId, sessionId }) {
  const result = await inTransaction(async (db) => {
    const s = await loadOwned(db, sessionId, userId, { forUpdate: true })
    if (s.status === 'ended') return { already: true, session: s }
    const now = Date.now()
    let pausedAdd = 0
    let state = s.engineState
    if (s.status === 'paused') { const rr = engine.resume(state, now); state = rr.state; pausedAdd = rr.pausedMs }
    const r = engine.end(state, now, s.config)
    await applyChanges(db, s, r.state, r.changes)
    const events = await model.listEvents(db, sessionId, userId)
    const pausedMs = s.pausedMs + pausedAdd
    const report = engine.buildReport({
      startedAt: s.startedAt, endedAt: new Date(now).toISOString(), pausedMs, state: r.state, events, config: s.config, features: s.features, identityRequested: !!r.state.identityRequested,
    })
    report.monitoredMs = r.state.totals.monitoredMs
    report.retentionUntil = s.retentionUntil
    const saved = await model.saveState(db, sessionId, userId, r.state, { status: 'ended', pausedMsAdd: pausedAdd, endedAt: now, report, clearReference: true })
    return { already: false, session: saved, referenceKey: s.referenceKey }
  })
  if (result.referenceKey) await ai.deleteFaceReference(result.referenceKey)
  const events = await model.listEvents(pool, sessionId, userId)
  const now = Date.now()
  return { session: publicSession(result.session, now), report: result.session.report, events: events.map((e) => publicEvent(e, now)) }
}

async function getReport({ userId, sessionId }) {
  const s = await loadOwned(pool, sessionId, userId)
  if (s.status !== 'ended' || !s.report) throw httpError(409, 'The report is available after monitoring has ended.', 'report_not_ready')
  const events = await model.listEvents(pool, sessionId, userId)
  const now = Date.now()
  return { session: publicSession(s, now), report: s.report, events: events.map((e) => publicEvent(e, now)) }
}

async function deleteSession({ userId, sessionId }) {
  const s = await loadOwned(pool, sessionId, userId)
  if (s.assessmentAttemptId != null) throw httpError(409, 'This monitoring record belongs to a job assessment and is kept until its retention date so the hiring team can review it.', 'assessment_record')
  const removed = await model.deleteOwned(pool, sessionId, userId)
  if (!removed) throw notFound()
  if (removed.referenceKey) await ai.deleteFaceReference(removed.referenceKey)
  return { deleted: true }
}

/** Ends any still-running session linked to an attempt (used when the attempt is submitted or expires). Best effort. */
async function endForAttempt({ userId, attemptId }) {
  const { sessions } = await model.listForAttempt(pool, attemptId)
  for (const s of sessions) {
    if (s.userId === userId && s.status !== 'ended') { try { await endSession({ userId, sessionId: s.id }) } catch { /* the attempt result never depends on this */ } }
  }
}

/** Monitoring record of an attempt for an AUTHORIZED reviewer: sessions, events, features and the stated limitations. */
async function recordForAttempt(attemptId) {
  const { sessions, events } = await model.listForAttempt(pool, attemptId)
  const now = Date.now()
  return {
    // `measurements` are the engine's own stored counters (no images, no derived scores) so reviewers can see exactly what
    // was and was not measured; unavailable features simply have zero evaluated time.
    sessions: sessions.map((s) => ({ ...publicSession(s, now), report: s.report || null, measurements: (s.engineState && s.engineState.totals) || null })),
    events: events.map((e) => ({ ...publicEvent(e, now), sessionId: e.sessionId })),
    limitations: [
      'Events are observations computed from camera frames, not findings of misconduct.',
      'Head direction and gaze are estimates and are only available when the optional face model is installed (see features).',
      'Missing frames, camera interruptions and service outages are recorded as technical issues, never as absence or behaviour.',
      'No video or images were stored. Monitoring is not part of any score.',
    ],
  }
}

module.exports = {
  CONSENT_VERSION, ASSESSMENT_CONSENT_VERSION, FRAME_INTERVAL_MS, getCapabilities, createSession, getSession, listSessions, submitFrame, reportCameraStatus,
  captureReference, pauseSession, resumeSession, endSession, getReport, deleteSession, privacyNotice, publicEvent,
  assessmentPrivacyNotice, endForAttempt, recordForAttempt,
}
