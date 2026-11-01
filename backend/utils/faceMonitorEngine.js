/**
 * Face-monitoring timing engine (pure functions, no I/O).
 *
 * The AI service looks at ONE frame and returns measurements. This engine turns a stream of those measurements, each
 * stamped with SERVER time, into explainable events: "the face was not visible for 18 s", "two faces for 6 s".
 *
 * Principles (each is covered by tests in tests/phaseQ/face_engine.test.js):
 *  - OBSERVATIONS, NOT VERDICTS. Nothing here says anyone cheated. `review_recommended` means "a person may want to look",
 *    with the numbers that triggered it. Nothing is scored, deducted or disqualified from this module.
 *  - UNKNOWN IS NOT A BEHAVIOUR. A dark or blurred frame, an unreadable gaze, a camera error or a service outage is
 *    "unknown" or a `technical_issue`. It is never counted as absence, gaze deviation or a mismatch, and never as zero.
 *  - ONE CONTINUOUS EVENT = ONE ROW. A run of consecutive frames with the same condition becomes a single event with a
 *    start, an end and a duration. A run shorter than its threshold never becomes an event (a single glance, a brief
 *    loss of the face, a head turn to think are not events).
 *  - THRESHOLDS ARE CONFIGURATION, stored with the session, so a report can say what was applied.
 *
 * State is plain JSON (stored in face_monitoring_sessions.engine_state). Functions return a new state plus `changes`,
 * which the service applies to the events table: {op:'open'|'update'|'close'|'instant', track, ...}.
 */
const VERSION = 1

const DEFAULT_CONFIG = {
  frameIntervalMs: 2000,
  gapMs: 10000,                 // no frame for this long = monitoring gap (technical), runs are cut
  continuityMs: 8000,           // unknown frames tolerated inside a run before it is closed
  absence: { observationMs: 5000, warningMs: 15000 },
  multiFace: { observationMs: 3000, warningMs: 10000 },
  head: { yawDeg: 30, pitchDeg: 25, observationMs: 4000, warningMs: 20000 },
  gaze: { deviation: 0.5, observationMs: 4000, warningMs: 20000 },
  identity: { observationMs: 6000 },
  quality: { technicalMs: 6000 },
  review: {
    minValidMs: 30000,
    multiEvents: 3, multiSingleMs: 30000,
    absentTotalMs: 90000, absentSingleMs: 45000,
    headShare: 0.3, headMinMs: 60000,
    gazeShare: 0.4, gazeMinMs: 60000,
    identityShare: 0.5, identityMinFrames: 10,
  },
}

/** Env overrides, each validated; an invalid value falls back to the default with a warning (never throws). */
const ENV_KEYS = [
  ['FACE_ABSENCE_SEC', ['absence', 'observationMs'], 1000, 2, 120],
  ['FACE_ABSENCE_WARN_SEC', ['absence', 'warningMs'], 1000, 5, 600],
  ['FACE_MULTI_SEC', ['multiFace', 'observationMs'], 1000, 1, 60],
  ['FACE_HEAD_YAW_DEG', ['head', 'yawDeg'], 1, 10, 80],
  ['FACE_HEAD_PITCH_DEG', ['head', 'pitchDeg'], 1, 10, 80],
  ['FACE_HEAD_SEC', ['head', 'observationMs'], 1000, 1, 120],
  ['FACE_GAZE_DEVIATION', ['gaze', 'deviation'], 1, 0.2, 0.95],
  ['FACE_GAZE_SEC', ['gaze', 'observationMs'], 1000, 1, 120],
]

function loadConfig(env = process.env) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  const warnings = []
  for (const [name, path, mult, min, max] of ENV_KEYS) {
    const raw = env[name]
    if (raw === undefined || String(raw).trim() === '') continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || n > max) { warnings.push(`${name} ignored (must be a number from ${min} to ${max}); default used.`); continue }
    config[path[0]][path[1]] = n * mult
  }
  if (config.absence.warningMs < config.absence.observationMs) { config.absence.warningMs = config.absence.observationMs * 3; warnings.push('Absence warning threshold was lower than the observation threshold; adjusted.') }
  return { config, warnings }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const FACE_STATES = new Set(['face_present', 'no_face', 'unusable_frame'])
const STATUS = new Set(['ok', 'low_confidence', 'unavailable'])

/** Defensive normalisation of the AI-service reply. Throws on a shape that cannot be trusted. */
function normalizeObservation(raw) {
  if (!raw || typeof raw !== 'object' || !FACE_STATES.has(raw.faceState)) throw new Error('invalid face observation')
  const q = raw.quality && typeof raw.quality === 'object' ? raw.quality : {}
  const hp = raw.headPose && typeof raw.headPose === 'object' ? raw.headPose : {}
  const gz = raw.gaze && typeof raw.gaze === 'object' ? raw.gaze : {}
  const id = raw.identity && typeof raw.identity === 'object' ? raw.identity : {}
  const count = isNum(raw.faceCount) && raw.faceCount >= 0 ? Math.min(20, Math.floor(raw.faceCount)) : null
  return {
    faceState: raw.faceState,
    faceCount: raw.faceState === 'unusable_frame' ? null : (count ?? (raw.faceState === 'no_face' ? 0 : 1)),
    quality: {
      usable: q.usable !== false,
      issues: Array.isArray(q.issues) ? q.issues.filter((s) => typeof s === 'string').slice(0, 8) : [],
      hints: Array.isArray(q.hints) ? q.hints.filter((s) => typeof s === 'string').slice(0, 8) : [],
      brightness: isNum(q.brightness) ? q.brightness : null,
      sharpness: isNum(q.sharpness) ? q.sharpness : null,
    },
    headPose: { status: STATUS.has(hp.status) ? hp.status : 'unavailable', yaw: isNum(hp.yaw) ? hp.yaw : null, pitch: isNum(hp.pitch) ? hp.pitch : null, roll: isNum(hp.roll) ? hp.roll : null, reason: typeof hp.reason === 'string' ? hp.reason.slice(0, 60) : null },
    gaze: { status: STATUS.has(gz.status) ? gz.status : 'unavailable', deviation: isNum(gz.deviation) ? gz.deviation : null, side: ['left', 'right', 'centre'].includes(gz.side) ? gz.side : null, reason: typeof gz.reason === 'string' ? gz.reason.slice(0, 60) : null },
    identity: {
      status: ['not_configured', 'unavailable', 'verified', 'verification_failed'].includes(id.status) ? id.status : 'not_configured',
      similarity: isNum(id.similarity) ? id.similarity : null, reason: typeof id.reason === 'string' ? id.reason.slice(0, 60) : null,
    },
    detector: typeof raw.detector === 'string' ? raw.detector.slice(0, 40) : null,
  }
}

const emptyTrack = () => ({ runStart: null, lastActive: null, opened: false, eventId: null, category: null, peak: null })

function initState(startMs, identityRequested = false) {
  return {
    v: VERSION,
    startedAt: startMs,
    lastFrameAt: null,
    pausedAt: null,
    identityRequested: !!identityRequested,
    totals: {
      framesTotal: 0, framesFacePresent: 0, framesNoFace: 0, framesUnusable: 0,
      monitoredMs: 0, faceVisibleMs: 0, faceAbsentMs: 0, unusableMs: 0, multiFaceMs: 0, maxFaces: 0,
      headEvaluatedMs: 0, headDeviationMs: 0, gazeEvaluatedMs: 0, gazeDeviationMs: 0,
      identityEvaluated: 0, identityVerified: 0, identityFailed: 0, identityUnavailable: 0,
      headPoseFrames: 0, gazeFrames: 0, gazeLowConfidenceFrames: 0, gapMs: 0, gapCount: 0,
    },
    tracks: { absence: emptyTrack(), multiFace: emptyTrack(), head: emptyTrack(), gaze: emptyTrack(), identity: emptyTrack(), quality: emptyTrack(), camera: emptyTrack(), processing: emptyTrack() },
    reviewFired: {},
    last: null,
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o))
const sec = (ms) => Math.round(ms / 100) / 10

/* ------------------------------ event definitions ------------------------------ */
function describe(track, durationMs, extra, cfg) {
  const d = `${sec(durationMs)} s`
  switch (track) {
    case 'absence': return `No face was detected for ${d}. This can happen when someone leans out of frame, the camera moves, or the face is hard to detect; it is not a finding of misconduct.`
    case 'multiFace': return `${extra && extra.maxFaces ? extra.maxFaces : 'More than one'} faces were detected for ${d}. A poster, a photo, a mirror or a passer-by can look like a second face; this is not a finding that anyone helped.`
    case 'head': return `The head was turned or tilted beyond ${cfg.head.yawDeg}° sideways or ${cfg.head.pitchDeg}° up or down for ${d}. People look down at paper, keyboards or think by turning; this is an observation only.`
    case 'gaze': return `Estimated horizontal gaze offset stayed above ${cfg.gaze.deviation} for ${d}. This is a rough webcam estimate, not an eye tracker, and does not show where or why someone looked.`
    case 'identity': return `The live face did not match the reference captured at the start for ${d} (similarity ${extra && extra.similarity != null ? extra.similarity : 'n/a'}). Lighting, angle, glasses or a different pose can cause this; it does not establish who is present.`
    case 'quality': return `The image was too dark, bright or blurry to analyse for ${d}. Time like this is not counted as absence.`
    default: return ''
  }
}

const TYPE = { absence: 'face_absent', multiFace: 'multiple_faces', head: 'head_pose_deviation', gaze: 'gaze_deviation', identity: 'identity_mismatch', quality: 'poor_image_quality' }

function defFor(track, cfg) {
  switch (track) {
    case 'absence': return { observationMs: cfg.absence.observationMs, warningMs: cfg.absence.warningMs, category: 'observation' }
    case 'multiFace': return { observationMs: cfg.multiFace.observationMs, warningMs: cfg.multiFace.warningMs, category: 'observation' }
    case 'head': return { observationMs: cfg.head.observationMs, warningMs: cfg.head.warningMs, category: 'observation' }
    case 'gaze': return { observationMs: cfg.gaze.observationMs, warningMs: cfg.gaze.warningMs, category: 'observation' }
    case 'identity': return { observationMs: cfg.identity.observationMs, warningMs: cfg.identity.observationMs, category: 'warning' }
    case 'quality': return { observationMs: cfg.quality.technicalMs, warningMs: Infinity, category: 'technical_issue' }
    default: return null
  }
}

function closeTrack(state, name, changes, cfg) {
  const t = state.tracks[name]
  if (t.opened && t.runStart != null) {
    const dur = Math.max(0, t.lastActive - t.runStart)
    changes.push({ op: 'close', track: name, eventId: t.eventId, endedAt: t.lastActive, durationMs: dur, category: t.category, explanation: describe(name, dur, t.peak, cfg) })
  }
  state.tracks[name] = emptyTrack()
}

function stepTrack(state, name, status, now, cfg, changes, extra) {
  const t = state.tracks[name]
  const def = defFor(name, cfg)
  if (status === 'active') {
    if (t.runStart == null) { t.runStart = now; t.peak = null }
    t.lastActive = now
    if (extra) t.peak = { ...(t.peak || {}), ...extra, maxFaces: Math.max((t.peak && t.peak.maxFaces) || 0, extra.maxFaces || 0) || undefined }
    const dur = now - t.runStart
    if (!t.opened && dur >= def.observationMs) {
      t.opened = true
      t.category = def.category
      changes.push({
        op: 'open', track: name, eventType: TYPE[name], category: t.category, startedAt: t.runStart,
        confidence: null, explanation: describe(name, dur, t.peak, cfg), evidence: { thresholdMs: def.observationMs, ...(t.peak || {}) },
      })
    } else if (t.opened && t.category === 'observation' && dur >= def.warningMs) {
      t.category = 'warning'
      changes.push({ op: 'update', track: name, eventId: t.eventId, category: 'warning', explanation: describe(name, dur, t.peak, cfg) })
    }
  } else if (status === 'inactive') {
    closeTrack(state, name, changes, cfg)
  } else if (t.runStart != null && now - t.lastActive > cfg.continuityMs) {
    closeTrack(state, name, changes, cfg)
  }
}

function closeAllRuns(state, cfg, changes, names = ['absence', 'multiFace', 'head', 'gaze', 'identity', 'quality']) {
  for (const n of names) if (state.tracks[n].runStart != null) closeTrack(state, n, changes, cfg)
}

function openTechnical(state, track, eventType, explanation, now, changes, evidence) {
  const t = state.tracks[track]
  if (t.opened) return
  state.tracks[track] = { ...emptyTrack(), runStart: now, lastActive: now, opened: true, category: 'technical_issue' }
  changes.push({ op: 'open', track, eventType, category: 'technical_issue', startedAt: now, confidence: null, explanation, evidence: evidence || null })
}

function resolveTechnical(state, track, now, changes) {
  const t = state.tracks[track]
  if (!t.opened) return false
  changes.push({ op: 'close', track, eventId: t.eventId, endedAt: now, durationMs: Math.max(0, now - t.runStart), category: 'technical_issue' })
  state.tracks[track] = emptyTrack()
  return true
}

/* ------------------------------ review recommendations ------------------------------ */
function reviewRules(state, cfg) {
  const T = state.totals
  const r = cfg.review
  const valid = T.faceVisibleMs + T.faceAbsentMs
  const out = []
  const longest = (name) => state.longest ? (state.longest[name] || 0) : 0
  if (state.counts && (state.counts.multiFace >= r.multiEvents || longest('multiFace') >= r.multiSingleMs)) {
    out.push({ id: 'repeated_multiple_faces', title: 'More than one face was detected repeatedly or for a long time',
      evidence: { events: state.counts.multiFace, longestMs: longest('multiFace'), thresholds: { events: r.multiEvents, singleMs: r.multiSingleMs } } })
  }
  if (T.faceAbsentMs >= r.absentTotalMs || longest('absence') >= r.absentSingleMs) {
    out.push({ id: 'prolonged_absence', title: 'The face was not visible for a long time',
      evidence: { totalAbsentMs: T.faceAbsentMs, longestMs: longest('absence'), thresholds: { totalMs: r.absentTotalMs, singleMs: r.absentSingleMs } } })
  }
  if (valid >= r.minValidMs && T.headEvaluatedMs >= r.headMinMs && T.headDeviationMs / T.headEvaluatedMs >= r.headShare) {
    out.push({ id: 'frequent_head_deviation', title: 'The head was turned or tilted for a large share of the time',
      evidence: { shareOfMeasuredTime: Math.round((T.headDeviationMs / T.headEvaluatedMs) * 100) / 100, measuredMs: T.headEvaluatedMs, thresholds: { share: r.headShare } } })
  }
  if (valid >= r.minValidMs && T.gazeEvaluatedMs >= r.gazeMinMs && T.gazeDeviationMs / T.gazeEvaluatedMs >= r.gazeShare) {
    out.push({ id: 'frequent_gaze_deviation', title: 'Estimated gaze was off-centre for a large share of the measurable time',
      evidence: { shareOfMeasuredTime: Math.round((T.gazeDeviationMs / T.gazeEvaluatedMs) * 100) / 100, measuredMs: T.gazeEvaluatedMs, thresholds: { share: r.gazeShare }, reliability: 'low (webcam estimate)' } })
  }
  if (T.identityEvaluated >= r.identityMinFrames && T.identityFailed / T.identityEvaluated >= r.identityShare) {
    out.push({ id: 'identity_mismatch_persistent', title: 'The same-person check did not match for most evaluated frames',
      evidence: { failedFrames: T.identityFailed, evaluatedFrames: T.identityEvaluated, thresholds: { share: r.identityShare } } })
  }
  return out
}

function applyReviewRules(state, cfg, now, changes) {
  for (const rule of reviewRules(state, cfg)) {
    if (state.reviewFired[rule.id]) continue
    state.reviewFired[rule.id] = true
    changes.push({
      op: 'instant', track: `review:${rule.id}`, eventType: `review_${rule.id}`, category: 'review_recommended', startedAt: now, endedAt: now, confidence: null,
      explanation: `Review recommended: ${rule.title}. This is based on measured counts and timings and is not a finding of misconduct; normal behaviour, lighting or camera placement can produce it.`,
      evidence: rule.evidence,
    })
  }
}

/* ------------------------------ public API ------------------------------ */
function bump(state, track, durationMs) {
  state.longest = state.longest || {}
  state.longest[track] = Math.max(state.longest[track] || 0, durationMs)
}

/**
 * One analysed frame. `obs` must come from normalizeObservation. `now` is SERVER time in ms.
 * Out-of-order frames (now <= lastFrameAt) are ignored: {stale:true}.
 */
function step(prev, obs, now, cfg = DEFAULT_CONFIG) {
  if (prev.lastFrameAt != null && now <= prev.lastFrameAt) return { state: prev, changes: [], stale: true }
  const state = clone(prev)
  state.counts = state.counts || { multiFace: 0, absence: 0 }
  const changes = []
  const T = state.totals

  // Camera / service problems end as soon as a frame is analysed again; that interval is a technical issue, not behaviour.
  const hadTechnical = state.tracks.camera.opened || state.tracks.processing.opened
  const hadOutage = hadTechnical
  if (hadTechnical) { closeAllRuns(state, cfg, changes); resolveTechnical(state, 'camera', now, changes); resolveTechnical(state, 'processing', now, changes) }

  let dt = 0
  if (state.lastFrameAt != null) {
    const gap = now - state.lastFrameAt
    if (gap > cfg.gapMs) {
      closeAllRuns(state, cfg, changes)
      T.gapMs += gap; T.gapCount += 1
      if (!hadOutage) {
        changes.push({ op: 'instant', track: 'gap', eventType: 'monitoring_gap', category: 'technical_issue', startedAt: state.lastFrameAt, endedAt: now, confidence: null,
          explanation: `No frames arrived for ${sec(gap)} s (the page may have been in the background, the computer slept, or the network dropped). Nothing could be measured during this time.`, evidence: { gapMs: gap } })
      }
    } else dt = gap
  }
  state.lastFrameAt = now
  T.framesTotal += 1
  T.monitoredMs += dt

  if (obs.faceState === 'face_present') { T.framesFacePresent += 1; T.faceVisibleMs += dt }
  else if (obs.faceState === 'no_face') { T.framesNoFace += 1; T.faceAbsentMs += dt }
  else { T.framesUnusable += 1; T.unusableMs += dt }

  // absence
  const absence = obs.faceState === 'no_face' ? 'active' : obs.faceState === 'face_present' ? 'inactive' : 'unknown'
  const absWasOpen = state.tracks.absence.opened
  stepTrack(state, 'absence', absence, now, cfg, changes)
  if (!absWasOpen && state.tracks.absence.opened) state.counts.absence += 1
  if (state.tracks.absence.runStart != null) bump(state, 'absence', state.tracks.absence.lastActive - state.tracks.absence.runStart)

  // multiple faces
  let multi = 'unknown'
  if (obs.faceState === 'face_present') { multi = obs.faceCount > 1 ? 'active' : 'inactive'; T.maxFaces = Math.max(T.maxFaces, obs.faceCount); if (obs.faceCount > 1) T.multiFaceMs += dt }
  else if (obs.faceState === 'no_face') multi = 'inactive'
  const multiWasOpen = state.tracks.multiFace.opened
  stepTrack(state, 'multiFace', multi, now, cfg, changes, multi === 'active' ? { maxFaces: obs.faceCount } : null)
  if (!multiWasOpen && state.tracks.multiFace.opened) state.counts.multiFace += 1
  if (state.tracks.multiFace.runStart != null) bump(state, 'multiFace', state.tracks.multiFace.lastActive - state.tracks.multiFace.runStart)

  // head pose
  let head = 'unknown'
  if (obs.faceState === 'face_present' && obs.headPose.status === 'ok' && obs.headPose.yaw != null && obs.headPose.pitch != null) {
    T.headPoseFrames += 1
    const out = Math.abs(obs.headPose.yaw) > cfg.head.yawDeg || Math.abs(obs.headPose.pitch) > cfg.head.pitchDeg
    head = out ? 'active' : 'inactive'
    T.headEvaluatedMs += dt
    if (out) T.headDeviationMs += dt
  }
  stepTrack(state, 'head', head, now, cfg, changes, head === 'active' ? { maxYaw: Math.max(Math.abs(obs.headPose.yaw), (state.tracks.head.peak && state.tracks.head.peak.maxYaw) || 0), maxPitch: Math.max(Math.abs(obs.headPose.pitch), (state.tracks.head.peak && state.tracks.head.peak.maxPitch) || 0) } : null)

  // gaze (only reliable estimates are evaluated)
  let gaze = 'unknown'
  if (obs.faceState === 'face_present' && obs.gaze.status === 'ok' && obs.gaze.deviation != null) {
    T.gazeFrames += 1
    const out = obs.gaze.deviation > cfg.gaze.deviation
    gaze = out ? 'active' : 'inactive'
    T.gazeEvaluatedMs += dt
    if (out) T.gazeDeviationMs += dt
  } else if (obs.faceState === 'face_present' && obs.gaze.status === 'low_confidence') T.gazeLowConfidenceFrames += 1
  stepTrack(state, 'gaze', gaze, now, cfg, changes, gaze === 'active' ? { maxDeviation: Math.max(obs.gaze.deviation, (state.tracks.gaze.peak && state.tracks.gaze.peak.maxDeviation) || 0) } : null)

  // identity (only when requested and evaluable)
  let identity = 'unknown'
  if (state.identityRequested) {
    if (obs.identity.status === 'verification_failed') { identity = 'active'; T.identityEvaluated += 1; T.identityFailed += 1 }
    else if (obs.identity.status === 'verified') { identity = 'inactive'; T.identityEvaluated += 1; T.identityVerified += 1 }
    else T.identityUnavailable += 1
  }
  stepTrack(state, 'identity', identity, now, cfg, changes, identity === 'active' ? { similarity: obs.identity.similarity } : null)

  // image quality (technical)
  const quality = obs.faceState === 'unusable_frame' || obs.quality.usable === false ? 'active' : 'inactive'
  stepTrack(state, 'quality', quality, now, cfg, changes, quality === 'active' ? { issues: obs.quality.issues } : null)

  applyReviewRules(state, cfg, now, changes)
  state.last = {
    at: now, faceState: obs.faceState, faceCount: obs.faceCount,
    quality: { usable: obs.quality.usable, issues: obs.quality.issues, hints: obs.quality.hints },
    headPose: obs.headPose, gaze: obs.gaze, identity: obs.identity, detector: obs.detector,
  }
  return { state, changes, stale: false }
}

/** Client reported a camera problem (permission, device lost...). Technical, never behaviour. */
const CAMERA_KINDS = {
  permission_denied: 'Camera permission was denied, so nothing could be monitored.',
  device_not_found: 'No camera was found.',
  device_in_use: 'The camera is in use by another application or tab.',
  track_ended: 'The camera stream stopped (the camera may have been unplugged or turned off).',
  stream_error: 'The camera stream reported an error.',
  preview_stalled: 'The camera preview froze.',
  capture_failed: 'The page could not capture a frame from the camera.',
}
function cameraIssue(prev, kind, now, cfg = DEFAULT_CONFIG) {
  if (!Object.prototype.hasOwnProperty.call(CAMERA_KINDS, kind)) throw new Error('unknown camera status')
  const state = clone(prev)
  const changes = []
  closeAllRuns(state, cfg, changes)
  openTechnical(state, 'camera', `camera_${kind}`, CAMERA_KINDS[kind], now, changes, { kind })
  return { state, changes }
}

/** The AI service failed or timed out for a frame. Technical; the engine does not guess what the frame would have shown. */
function processingIssue(prev, reason, now, cfg = DEFAULT_CONFIG) {
  const state = clone(prev)
  const changes = []
  closeAllRuns(state, cfg, changes)
  openTechnical(state, 'processing', 'analysis_unavailable', 'The face analysis service could not process frames, so this period was not measured.', now, changes, { reason: String(reason || 'unknown').slice(0, 60) })
  return { state, changes }
}

function pause(prev, now, cfg = DEFAULT_CONFIG) {
  const state = clone(prev)
  const changes = []
  closeAllRuns(state, cfg, changes)
  resolveTechnical(state, 'camera', now, changes)
  resolveTechnical(state, 'processing', now, changes)
  state.pausedAt = now
  state.lastFrameAt = null
  return { state, changes }
}

function resume(prev, now) {
  const state = clone(prev)
  const pausedMs = state.pausedAt != null ? Math.max(0, now - state.pausedAt) : 0
  state.pausedAt = null
  state.lastFrameAt = null
  return { state, pausedMs, changes: [] }
}

function end(prev, now, cfg = DEFAULT_CONFIG) {
  const state = clone(prev)
  const changes = []
  closeAllRuns(state, cfg, changes)
  resolveTechnical(state, 'camera', now, changes)
  resolveTechnical(state, 'processing', now, changes)
  applyReviewRules(state, cfg, now, changes)
  return { state, changes }
}

/* ------------------------------ report ------------------------------ */
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)
const INSUFFICIENT_MS = 30000

/**
 * @param {{ session: object, events: object[], state: object, config: object, features: object, pausedMs: number, endedAt: number }} p
 * Everything here is a measured count/duration/share; missing data is "unavailable" / "insufficient_data", never 0.
 */
function buildReport({ startedAt, endedAt, pausedMs = 0, state, events, config, features, identityRequested }) {
  const T = state.totals
  const valid = T.faceVisibleMs + T.faceAbsentMs
  const enough = valid >= INSUFFICIENT_MS
  const byType = (t) => events.filter((e) => e.eventType === t)
  const intervals = (t) => byType(t).map((e) => ({ startedAt: e.startedAt, endedAt: e.endedAt, durationMs: e.durationMs, category: e.category }))
  const count = (cat) => events.filter((e) => e.category === cat).length
  const feat = (key) => (features && features[key]) || { state: 'unavailable' }
  const hasState = (f) => (f.state === 'available' ? null : f)
  const limitations = []

  const card = (key, label, availability, measured, explanation, limits) => ({ key, label, availability, measured, explanation, limitations: limits || [] })

  const cards = []
  cards.push(card('faceDetection', 'Face detection', T.framesTotal === 0 ? 'insufficient_data' : enough ? 'measured' : 'insufficient_data',
    T.framesTotal === 0 ? null : { framesAnalysed: T.framesTotal, framesWithFace: T.framesFacePresent, framesWithoutFace: T.framesNoFace, framesUnusable: T.framesUnusable, faceVisibleSharePct: pct(T.faceVisibleMs, valid), detector: state.last ? state.last.detector : null },
    'Share of analysed time in which a face was detected (unusable frames are left out).', feat('faceDetection').note ? [feat('faceDetection').note] : []))
  cards.push(card('multipleFaces', 'Multiple faces', T.framesTotal === 0 ? 'insufficient_data' : 'measured',
    T.framesTotal === 0 ? null : { events: byType('multiple_faces').length, totalMs: T.multiFaceMs, maxFaces: T.maxFaces || null },
    'Counts continuous periods with more than one face. A photo, mirror or passer-by can cause this.'))
  const gazeFeat = feat('gaze')
  const gazeMeasured = T.gazeEvaluatedMs > 0
  cards.push(card('eyeGaze', 'Eye gaze', gazeMeasured ? 'measured' : gazeFeat.state !== 'available' ? 'unavailable' : 'insufficient_data',
    gazeMeasured ? { events: byType('gaze_deviation').length, measuredMs: T.gazeEvaluatedMs, offCentreSharePct: pct(T.gazeDeviationMs, T.gazeEvaluatedMs), lowConfidenceFrames: T.gazeLowConfidenceFrames } : null,
    !gazeMeasured && gazeFeat.state !== 'available' ? 'Gaze estimation needs the optional face-landmark model, which is not available.' : 'Rough horizontal iris offset from a normal webcam; only reliable frames are counted. It is not an eye tracker.',
    ['Low reliability: glasses glare, head angle and lighting affect it.']))
  const headFeat = feat('headPose')
  const headMeasured = T.headEvaluatedMs > 0
  cards.push(card('headMovement', 'Head movement', headMeasured ? 'measured' : headFeat.state !== 'available' ? 'unavailable' : 'insufficient_data',
    headMeasured ? { events: byType('head_pose_deviation').length, measuredMs: T.headEvaluatedMs, deviationSharePct: pct(T.headDeviationMs, T.headEvaluatedMs) } : null,
    !headMeasured && headFeat.state !== 'available' ? 'Head pose needs the optional face-landmark model, which is not available.' : 'Time with the head turned or tilted past the configured angles. Looking down at paper or thinking can cause this.'))
  const idFeat = feat('identity')
  let idAvail = 'not_configured'
  if (identityRequested) idAvail = T.identityEvaluated > 0 ? 'measured' : 'unavailable'
  else if (idFeat.state === 'available') idAvail = 'not_requested'
  cards.push(card('identity', 'Same-person check', idAvail,
    identityRequested && T.identityEvaluated > 0 ? { evaluatedFrames: T.identityEvaluated, matchedFrames: T.identityVerified, notMatchedFrames: T.identityFailed, unavailableFrames: T.identityUnavailable, outcome: T.identityFailed === 0 ? 'verified' : T.identityVerified === 0 ? 'verification_failed' : 'mixed' } : null,
    'Compares the live face with a reference captured at the start of this session. It does not prove legal identity and is never used to disqualify.'))
  cards.push(card('faceAbsence', 'Face absence', T.framesTotal === 0 ? 'insufficient_data' : 'measured',
    T.framesTotal === 0 ? null : { events: byType('face_absent').length, totalAbsentMs: T.faceAbsentMs, longestMs: (state.longest && state.longest.absence) || 0, intervals: intervals('face_absent') },
    'Time with no face detected. Dark, blurred or unreadable frames and camera outages are not counted as absence.'))
  cards.push(card('suspiciousActivity', 'Review flags', T.framesTotal === 0 ? 'insufficient_data' : 'measured',
    { observations: count('observation'), warnings: count('warning'), reviewRecommended: count('review_recommended'), technicalIssues: count('technical_issue') },
    'A summary of events. Warnings and review flags are prompts for a person to look, never a finding of misconduct.'))
  const qualityIssues = events.filter((e) => e.category === 'technical_issue')
  cards.push(card('cameraVisibility', 'Camera and face visibility', T.framesTotal === 0 ? 'insufficient_data' : 'measured',
    T.framesTotal === 0 ? null : { framesUnusable: T.framesUnusable, unusableSharePct: pct(T.framesUnusable, T.framesTotal), technicalIssues: qualityIssues.length, gapCount: T.gapCount, gapMs: T.gapMs },
    'Image quality and camera/service problems. These are technical issues, not behaviour.'))

  if (!enough) limitations.push('Less than 30 seconds of usable frames were analysed, so shares and review rules are not reliable.')
  if (headFeat.state !== 'available' || gazeFeat.state !== 'available') limitations.push('Head pose and gaze need the optional face-landmark model; unavailable measurements are shown as unavailable, not as zero.')
  if (T.framesUnusable > 0) limitations.push(`${T.framesUnusable} frame(s) were too dark, bright or blurry to analyse.`)
  if (T.gapCount > 0) limitations.push(`${T.gapCount} period(s) with no frames (${sec(T.gapMs)} s in total) were not measured.`)

  const reviewRecommendations = events.filter((e) => e.category === 'review_recommended').map((e) => ({ id: e.eventType.replace(/^review_/, ''), explanation: e.explanation, evidence: e.evidence, at: e.startedAt }))
  return {
    version: VERSION,
    startedAt, endedAt,
    monitoredMs: T.monitoredMs, pausedMs, validFrames: T.framesTotal - T.framesUnusable, framesAnalysed: T.framesTotal,
    cards,
    intervals: { faceAbsent: intervals('face_absent'), multipleFaces: intervals('multiple_faces'), headDeviation: intervals('head_pose_deviation'), gazeDeviation: intervals('gaze_deviation') },
    technicalIssues: qualityIssues.map((e) => ({ type: e.eventType, startedAt: e.startedAt, endedAt: e.endedAt, durationMs: e.durationMs, explanation: e.explanation })),
    reviewRecommendations,
    limitations,
    notices: [
      'These are automated measurements of camera frames. They are observations, not a determination of misconduct, and they are not part of any interview or coding score.',
      'The module does not read emotion, honesty, attention or intent, and no video or images are stored.',
    ],
  }
}

module.exports = {
  VERSION, DEFAULT_CONFIG, CAMERA_KINDS, loadConfig, normalizeObservation, initState, step, cameraIssue, processingIssue, pause, resume, end, buildReport, reviewRules,
}
