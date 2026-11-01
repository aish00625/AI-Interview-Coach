/**
 * Pure helpers for the optional face-monitoring module: wording, formatting and view-models. No React, no network, no browser APIs,
 * so everything here is unit-tested (faceMonitor.test.js). The wording follows one rule: measurements and observations only. Nothing
 * here says someone cheated, and an unavailable measurement is never shown as zero.
 */

export const CATEGORY_META = {
  observation: { label: 'Observation', tone: 'info', blurb: 'Something noticed. Often harmless.' },
  warning: { label: 'Warning', tone: 'warning', blurb: 'Lasted longer than usual. Worth a look.' },
  review_recommended: { label: 'Review suggested', tone: 'violet', blurb: 'A pattern a person should look at. Not a finding of misconduct.' },
  technical_issue: { label: 'Technical issue', tone: 'muted', blurb: 'A camera, lighting or service problem. Not your behaviour.' },
}

export const EVENT_TITLES = {
  face_absent: 'No face in view',
  multiple_faces: 'More than one face in view',
  head_pose_deviation: 'Head turned or tilted for a while',
  gaze_deviation: 'Eyes looked off to one side',
  identity_mismatch: 'Face differed from the start-of-session photo',
  poor_image_quality: 'Image too dark, bright or blurry to analyse',
  monitoring_gap: 'No frames received',
  analysis_unavailable: 'Analysis service unavailable',
  camera_permission_denied: 'Camera permission denied',
  camera_device_not_found: 'No camera found',
  camera_device_in_use: 'Camera in use elsewhere',
  camera_track_ended: 'Camera stream stopped',
  camera_stream_error: 'Camera stream error',
  camera_preview_stalled: 'Camera preview froze',
  camera_capture_failed: 'Could not capture a frame',
  review_repeated_multiple_faces: 'Review: repeated extra faces',
  review_prolonged_absence: 'Review: long total absence',
  review_frequent_head_deviation: 'Review: frequent head turning',
  review_frequent_gaze_deviation: 'Review: frequent sideways gaze',
  review_identity_mismatch_persistent: 'Review: persistent face difference',
}

export function eventTitle(type) {
  if (EVENT_TITLES[type]) return EVENT_TITLES[type]
  return String(type || 'event').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export const UNAVAILABLE_REASONS = {
  needs_landmark_model: 'Needs the optional face-landmark model.',
  needs_recognition_model: 'Needs the optional face-recognition model.',
  face_analysis_unavailable: 'Face analysis is not available on the AI service.',
}
export const reasonText = (reason) => UNAVAILABLE_REASONS[reason] || (reason ? String(reason).replace(/_/g, ' ') : '')

/** "1 h 02 min", "3 min 05 s", "12 s". Null or negative values give an em dash (unknown), never "0 s". */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total} s`
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return s ? `${m} min ${String(s).padStart(2, '0')} s` : `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')} min`
}

export function formatClock(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const num = (v, digits = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : null)

/* ------------------------------------------------------------------ camera errors */

/** Maps a getUserMedia / track error to one of the statuses the server accepts, plus words the person can act on. */
export function classifyCameraError(err) {
  const name = (err && err.name) || ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return { status: 'permission_denied', message: 'Camera permission was denied. Allow camera access for this site in your browser settings (the camera icon in the address bar), then try again.' }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { status: 'device_not_found', message: 'No camera was found. Connect or enable a camera, then try again.' }
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { status: 'device_in_use', message: 'The camera could not be opened. Another app or browser tab may be using it. Close it and try again.' }
  }
  return { status: 'stream_error', message: 'The camera could not be started. Check that it is connected and not blocked, then try again.' }
}

export const CAMERA_LOST_MESSAGE = 'The camera stopped (it may have been unplugged or turned off). This time is not measured. Reconnect it and press "Restart camera".'

/* ------------------------------------------------------------------ live status */

const GAZE_SIDE = { left: 'left', right: 'right', centre: 'centre' }

/** Rows for the live status panel from the server's latest analysed frame (`session.current`). Unavailable stays unavailable. */
export function liveStatusRows(current, features) {
  const f = features || {}
  const rows = []
  if (!current) {
    return [{ key: 'face', label: 'Face', value: 'Waiting for the first frame…', tone: 'muted' }]
  }
  const fs = current.faceState
  rows.push({
    key: 'face', label: 'Face',
    value: fs === 'face_present' ? 'Detected' : fs === 'no_face' ? 'Not detected' : 'Frame not usable (see tips)',
    tone: fs === 'face_present' ? 'success' : fs === 'no_face' ? 'warning' : 'muted',
  })
  rows.push({ key: 'count', label: 'Faces in view', value: current.faceCount == null ? '—' : String(current.faceCount), tone: current.faceCount > 1 ? 'warning' : 'neutral' })

  const hp = current.headPose || {}
  if (hp.status === 'ok' && num(hp.yaw) !== null) {
    rows.push({ key: 'head', label: 'Head direction', value: `yaw ${num(hp.yaw)}°, pitch ${num(hp.pitch)}°, roll ${num(hp.roll)}°`, tone: 'neutral' })
  } else {
    rows.push({ key: 'head', label: 'Head direction', value: hp.status === 'low_confidence' ? 'Low confidence' : `Unavailable${f.headPose && f.headPose.state !== 'available' ? ' — ' + reasonText(f.headPose.reason) : ''}`, tone: 'muted' })
  }
  const gz = current.gaze || {}
  if (gz.status === 'ok' && num(gz.deviation, 2) !== null) {
    rows.push({ key: 'gaze', label: 'Gaze (rough, horizontal)', value: `${GAZE_SIDE[gz.side] || 'centre'}, offset ${num(gz.deviation, 2)}`, tone: 'neutral' })
  } else {
    rows.push({ key: 'gaze', label: 'Gaze (rough, horizontal)', value: gz.status === 'low_confidence' ? 'Low confidence, not counted' : `Unavailable${f.gaze && f.gaze.state !== 'available' ? ' — ' + reasonText(f.gaze.reason) : ''}`, tone: 'muted' })
  }
  rows.push({ key: 'identity', label: 'Same-person check', ...identityRow(current.identity, f.identity) })
  return rows
}

function identityRow(identity, feature) {
  const st = identity && identity.status
  if (st === 'verified') return { value: 'Matches the start photo', tone: 'success' }
  if (st === 'verification_failed') return { value: 'Does not match the start photo (needs a person to look; not a verdict)', tone: 'warning' }
  if (st === 'unavailable') return { value: 'Unavailable for this frame', tone: 'muted' }
  if (feature && feature.state === 'not_configured') return { value: 'Not configured', tone: 'muted' }
  return { value: 'Not configured', tone: 'muted' }
}

/** Plain tips from the server's quality hints, de-duplicated and capped. */
export function qualityTips(current) {
  const hints = (current && current.quality && current.quality.hints) || []
  return [...new Set(hints.filter((h) => typeof h === 'string' && h.trim()))].slice(0, 4)
}

/* ------------------------------------------------------------------ events */

/** Merges events from a frame response into the list by id. Newer data wins; newest first for display. */
export function mergeEvents(existing, newEvents = [], updatedEvents = []) {
  const byId = new Map((existing || []).map((e) => [e.id, e]))
  for (const e of [...newEvents, ...updatedEvents]) if (e && e.id != null) byId.set(e.id, { ...byId.get(e.id), ...e })
  return [...byId.values()].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt) || b.id - a.id)
}

export function eventLine(e, now = Date.now()) {
  const ongoing = e.status === 'ongoing'
  const ms = ongoing ? (typeof e.ongoingForMs === 'number' ? e.ongoingForMs : Math.max(0, now - new Date(e.startedAt).getTime())) : e.durationMs
  return {
    title: eventTitle(e.type),
    meta: meta(e),
    duration: ms == null ? '—' : formatDuration(ms),
    stateLabel: ongoing ? 'Ongoing' : 'Resolved',
    category: CATEGORY_META[e.category] || CATEGORY_META.observation,
    confidence: typeof e.confidence === 'number' ? `${Math.round(e.confidence * 100)}%` : 'Not available',
  }
}
const meta = (e) => `${formatClock(e.startedAt)}${e.endedAt && e.status !== 'ongoing' ? ' – ' + formatClock(e.endedAt) : ''}`

export function filterEvents(events, category) {
  if (!category || category === 'all') return events
  return events.filter((e) => e.category === category)
}

/* ------------------------------------------------------------------ report cards */

const AVAILABILITY = {
  measured: { label: 'Measured', tone: 'success' },
  insufficient_data: { label: 'Not enough data', tone: 'muted' },
  unavailable: { label: 'Unavailable', tone: 'muted' },
  not_configured: { label: 'Not configured', tone: 'muted' },
  not_requested: { label: 'Not requested', tone: 'muted' },
}

/** One metric card's view-model. Anything not 'measured' shows no numbers at all, so a missing measurement cannot look like zero. */
export function cardView(card) {
  const a = AVAILABILITY[card.availability] || AVAILABILITY.unavailable
  const base = { key: card.key, label: card.label, stateLabel: a.label, tone: a.tone, explanation: card.explanation, limitations: card.limitations || [], headline: null, lines: [] }
  if (card.availability !== 'measured' || !card.measured) {
    base.headline = a.label === 'Measured' ? '—' : a.label
    return base
  }
  const m = card.measured
  const pct = (v) => (typeof v === 'number' ? `${v}%` : '—')
  switch (card.key) {
    case 'faceDetection':
      base.headline = `${pct(m.faceVisibleSharePct)} of analysed time`
      base.lines = [`${m.framesWithFace} frames with a face, ${m.framesWithoutFace} without`, m.framesUnusable ? `${m.framesUnusable} frames too poor to analyse (left out)` : null]
      break
    case 'multipleFaces':
      base.headline = `${m.events} period${m.events === 1 ? '' : 's'}`
      base.lines = [`${formatDuration(m.totalMs)} in total`, m.maxFaces ? `Most faces at once: ${m.maxFaces}` : null]
      break
    case 'eyeGaze':
      base.headline = `${pct(m.offCentreSharePct)} off-centre`
      base.lines = [`${m.events} period${m.events === 1 ? '' : 's'}; measured for ${formatDuration(m.measuredMs)}`, m.lowConfidenceFrames ? `${m.lowConfidenceFrames} low-confidence frames not counted` : null]
      break
    case 'headMovement':
      base.headline = `${pct(m.deviationSharePct)} turned or tilted`
      base.lines = [`${m.events} period${m.events === 1 ? '' : 's'}; measured for ${formatDuration(m.measuredMs)}`]
      break
    case 'identity':
      base.headline = m.outcome === 'verified' ? 'Matched throughout' : m.outcome === 'verification_failed' ? 'Did not match' : 'Mixed result'
      base.lines = [`${m.matchedFrames} matched, ${m.notMatchedFrames} not matched, ${m.unavailableFrames} unavailable (of ${m.evaluatedFrames} checked)`]
      break
    case 'faceAbsence':
      base.headline = formatDuration(m.totalAbsentMs)
      base.lines = [`${m.events} period${m.events === 1 ? '' : 's'}; longest ${formatDuration(m.longestMs)}`]
      break
    case 'suspiciousActivity':
      base.headline = `${m.reviewRecommended} review · ${m.warnings} warning · ${m.observations} observation`
      base.lines = [`${m.technicalIssues} technical issue${m.technicalIssues === 1 ? '' : 's'} (not behaviour)`]
      break
    case 'cameraVisibility':
      base.headline = `${pct(m.unusableSharePct)} of frames unusable`
      base.lines = [`${m.technicalIssues} technical issue${m.technicalIssues === 1 ? '' : 's'}`, m.gapCount ? `${m.gapCount} gap${m.gapCount === 1 ? '' : 's'} with no frames (${formatDuration(m.gapMs)})` : null]
      break
    default:
      base.headline = '—'
  }
  base.lines = base.lines.filter(Boolean)
  return base
}

/** The headline to show when something needs a human look. Always phrased as a suggestion. */
export function reviewSummary(report) {
  const n = (report && report.reviewRecommendations && report.reviewRecommendations.length) || 0
  if (!n) return 'No review suggestions were raised.'
  return `${n} pattern${n === 1 ? ' was' : 's were'} flagged for a person to look at. This is a prompt to review, not a finding of misconduct.`
}
