/**
 * Pure helpers for the assessment pages (kept free of React so they are unit tested).
 * The server decides timing, scoring and expiry; these only format what the server sent.
 */

/** Time left according to the SERVER: the server's "now" at fetch time is the anchor, so a wrong local clock does not matter. */
export function remainingMs(deadlineIso, serverNowIso, fetchedAtClientMs, nowClientMs) {
  if (!deadlineIso || !serverNowIso) return 0
  const serverNowAtFetch = new Date(serverNowIso).getTime()
  const elapsedSinceFetch = Math.max(0, nowClientMs - fetchedAtClientMs)
  return Math.max(0, new Date(deadlineIso).getTime() - (serverNowAtFetch + elapsedSinceFetch))
}

export function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Answered / total per section. MCQs count when at least one choice is saved; coding when at least one submission exists. */
export function answeredCounts(sections, answers, codingRuns) {
  const saved = new Set((answers || []).filter((a) => (a.selectedKeys || []).length).map((a) => a.itemId))
  const coded = new Set((codingRuns || []).map((r) => r.itemId))
  const out = {}
  for (const s of sections || []) {
    const ids = (s.items || []).map((i) => i.id)
    const done = ids.filter((id) => (s.kind === 'coding' ? coded : saved).has(id)).length
    out[s.id] = { answered: done, total: s.itemCount ?? ids.length, unanswered: Math.max(0, (s.itemCount ?? ids.length) - done) }
  }
  return out
}

export const SECTION_LABELS = { aptitude: 'Aptitude', technical: 'Technical MCQs', coding: 'Coding' }
export const CATEGORY_LABELS = {
  numerical: 'Numerical reasoning', logical: 'Logical reasoning', verbal: 'Verbal reasoning', general: 'General aptitude',
  programming: 'Programming fundamentals', dsa: 'Data structures & algorithms', dbms: 'DBMS', os: 'Operating systems',
  networks: 'Computer networks', java: 'Java', python: 'Python', javascript: 'JavaScript', cpp: 'C++', web: 'Web', other: 'Other',
}

export const SKIP_REASONS = {
  no_assessment_consent: 'has not agreed to share assessment results',
  application_not_active: 'application is no longer active',
  not_an_applicant_for_this_job: 'is not an applicant for this job',
}

export const MONITORING_CHOICE_LABELS = {
  camera: 'Camera monitoring', alternative: 'Alternative (no camera) - accommodation', not_required: 'Not enabled for this assessment',
}

/** Neutral wording for face-monitoring event categories: observations, never accusations. */
export const EVENT_CATEGORY_LABELS = {
  observation: 'Observation', warning: 'Observation (longer)', technical_issue: 'Technical issue', review_recommended: 'May be worth a look',
}

/**
 * What the candidate is told about camera monitoring, derived ONLY from what has actually happened: "active" requires a
 * live camera AND at least one frame accepted by the server. `startError` is set when the monitoring session could not be
 * created. Never claims monitoring is running when it is not.
 */
export function monitoringStatus(live, startError) {
  const cam = (live && live.camera) || { state: 'off' }
  const NOTE = 'You can continue the assessment; this is recorded as a technical issue, not against you.'
  if (startError) return { tone: 'warning', label: 'Monitoring unavailable', detail: `${startError} ${NOTE}`, active: false, canRetry: true }
  if (cam.state === 'error') return { tone: 'warning', label: 'Camera problem', detail: `${cam.message} ${NOTE}`, active: false, canRestart: true }
  if (live.phase === 'starting' || cam.state === 'starting') return { tone: 'muted', label: 'Camera starting', detail: 'Waiting for camera permission and the first picture...', active: false }
  if (live.phase === 'running' && cam.state === 'live') {
    if (live.serviceTrouble) return { tone: 'warning', label: 'Analysis unavailable', detail: `The camera is on but frames are not being analysed right now. ${NOTE}`, active: false }
    if (live.lastError) return { tone: 'warning', label: 'Camera on - frames failing', detail: `${live.lastError} ${NOTE}`, active: false }
    if (!live.framesSent) return { tone: 'info', label: 'Camera on - connecting', detail: 'The camera is on; waiting for the first frame to be analysed.', active: false }
    return { tone: 'success', label: 'Monitoring active', detail: `${live.framesSent} frame(s) analysed. Events are observations only and never change your score. No video or images are stored.`, active: true }
  }
  if (live.phase === 'stopped' && live.ended) return { tone: 'muted', label: 'Monitoring ended', detail: 'Monitoring has stopped for this attempt.', active: false }
  return { tone: 'muted', label: 'Camera off', detail: 'Monitoring is not running.', active: false }
}

export const QUALITY_ISSUE_LABELS = {
  too_dark: 'Too dark', too_bright: 'Too bright', low_contrast: 'Low contrast / backlit', blurry: 'Blurry',
  face_too_small: 'Face too small (far from camera)', face_too_close: 'Face too close', face_partly_out_of_frame: 'Face partly out of frame',
}

const sum = (list, f) => list.reduce((n, x) => n + (Number(f(x)) || 0), 0)
const pctOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

/**
 * Summarises an attempt's STORED monitoring record (sessions with the engine's counters, plus events) for reviewers.
 * Only counts what was recorded: a feature with no valid measurement is reported as unavailable (null), never as 0.
 * Nothing here is a score: shares are "share of measured time", with the measured time shown next to them.
 */
export function monitoringAnalysis(record) {
  const sessions = (record && record.sessions) || []
  const events = (record && record.events) || []
  const m = sessions.map((s) => s.measurements || {})
  const byType = (t) => events.filter((e) => e.type === t)
  const featureState = (key) => {
    const states = sessions.map((s) => s.features && s.features[key] && s.features[key].state).filter(Boolean)
    return states.includes('available') ? 'available' : (states[0] || 'unavailable')
  }
  const framesAnalysed = sum(m, (x) => x.framesTotal)
  const framesUnusable = sum(m, (x) => x.framesUnusable)
  const timed = (evaluatedKey, deviationKey, framesKey, eventType, feature) => {
    const measuredMs = sum(m, (x) => x[evaluatedKey])
    if (featureState(feature) !== 'available') return { available: false, reason: 'The optional face-landmark model was not available, so this was not measured.' }
    if (!measuredMs) return { available: false, reason: framesAnalysed ? 'No frame gave a reliable measurement.' : 'No frames were analysed.' }
    const deviationMs = sum(m, (x) => x[deviationKey])
    return { available: true, measuredMs, deviationMs, sharePct: pctOf(deviationMs, measuredMs), frames: sum(m, (x) => x[framesKey]), events: byType(eventType).length }
  }
  const head = timed('headEvaluatedMs', 'headDeviationMs', 'headPoseFrames', 'head_pose_deviation', 'headPose')
  const gaze = timed('gazeEvaluatedMs', 'gazeDeviationMs', 'gazeFrames', 'gaze_deviation', 'gaze')
  if (gaze.available) gaze.lowConfidenceFrames = sum(m, (x) => x.gazeLowConfidenceFrames)

  const qualityEvents = byType('poor_image_quality').map((e) => ({
    id: e.id, startedAt: e.startedAt, durationMs: e.durationMs, ongoing: e.status === 'ongoing',
    issues: Array.isArray(e.evidence && e.evidence.issues) ? e.evidence.issues : [],
  }))
  const issueCounts = {}
  for (const q of qualityEvents) for (const i of q.issues) issueCounts[i] = (issueCounts[i] || 0) + 1
  const identityStates = sessions.map((s) => s.identity && s.identity.status).filter(Boolean)

  return {
    hasData: sessions.length > 0,
    sessions: sessions.length,
    frames: {
      analysed: framesAnalysed, usable: framesAnalysed - framesUnusable, unusable: framesUnusable,
      facePresent: sum(m, (x) => x.framesFacePresent), noFace: sum(m, (x) => x.framesNoFace),
    },
    time: { monitoredMs: sum(m, (x) => x.monitoredMs), faceVisibleMs: sum(m, (x) => x.faceVisibleMs), faceAbsentMs: sum(m, (x) => x.faceAbsentMs), unusableMs: sum(m, (x) => x.unusableMs) },
    multipleFaces: { events: byType('multiple_faces').length, totalMs: sum(m, (x) => x.multiFaceMs), maxFaces: Math.max(0, ...m.map((x) => Number(x.maxFaces) || 0)) || null },
    noFaceEvents: byType('face_absent').length,
    technicalIssues: events.filter((e) => e.category === 'technical_issue').length,
    gaps: { count: sum(m, (x) => x.gapCount), totalMs: sum(m, (x) => x.gapMs) },
    head, gaze,
    quality: { events: qualityEvents, issueCounts, totalMs: sum(qualityEvents, (q) => q.durationMs) },
    identity: { state: featureState('identity'), statuses: identityStates },
  }
}

export function emptyDefinition() {
  return {
    jobId: '', title: '', description: '', instructions: '', durationMinutes: 60, maxAttempts: 1, passPercent: '',
    availableFrom: '', availableUntil: '', monitoringEnabled: true,
    sections: [
      { kind: 'aptitude', enabled: true, durationMinutes: '', allowBack: true, randomize: false, negativeMarking: 0, items: [] },
      { kind: 'technical', enabled: true, durationMinutes: '', allowBack: true, randomize: false, negativeMarking: 0, items: [] },
      { kind: 'coding', enabled: true, durationMinutes: '', allowBack: true, randomize: false, negativeMarking: 0, items: [] },
    ],
  }
}

const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Turns the server's detail into the editable form (disabled sections kept so they can be switched back on). */
export function definitionFromDetail(detail) {
  const a = detail.assessment
  const base = emptyDefinition()
  const byKind = Object.fromEntries((detail.sections || []).map((s) => [s.kind, s]))
  const order = (detail.sections || []).map((s) => s.kind)
  const kinds = [...order, ...['aptitude', 'technical', 'coding'].filter((k) => !order.includes(k))]
  return {
    jobId: String(a.jobId), title: a.title || '', description: a.description || '', instructions: a.instructions || '',
    durationMinutes: a.durationMinutes, maxAttempts: a.maxAttempts, passPercent: a.passPercent ?? '',
    availableFrom: toLocalInput(a.availableFrom), availableUntil: toLocalInput(a.availableUntil), monitoringEnabled: a.monitoringEnabled,
    sections: kinds.map((k) => {
      const s = byKind[k]
      if (!s) return { ...base.sections.find((x) => x.kind === k), enabled: false }
      return {
        kind: k, enabled: true, durationMinutes: s.durationMinutes ?? '', allowBack: s.allowBack, randomize: s.randomize, negativeMarking: s.negativeMarking,
        items: s.items.map((i) => ({ mcqQuestionId: i.mcqQuestionId, codingProblemId: i.codingProblemId, marks: i.marks, summary: i.summary })),
      }
    }),
  }
}

/** The request body the API expects. Disabled sections are left out; empty optional fields become null. */
export function toPayload(form) {
  const num = (v) => (v === '' || v == null ? null : Number(v))
  const when = (v) => (v ? new Date(v).toISOString() : null)
  return {
    jobId: Number(form.jobId), title: form.title.trim(), description: form.description, instructions: form.instructions,
    durationMinutes: Number(form.durationMinutes), maxAttempts: Number(form.maxAttempts), passPercent: num(form.passPercent),
    availableFrom: when(form.availableFrom), availableUntil: when(form.availableUntil), monitoringEnabled: Boolean(form.monitoringEnabled),
    sections: form.sections.filter((s) => s.enabled).map((s) => ({
      kind: s.kind, durationMinutes: num(s.durationMinutes), allowBack: Boolean(s.allowBack), randomize: s.kind !== 'coding' && Boolean(s.randomize),
      negativeMarking: s.kind === 'coding' ? 0 : Number(s.negativeMarking || 0),
      items: s.items.map((i) => (s.kind === 'coding' ? { codingProblemId: i.codingProblemId, marks: Number(i.marks) } : { mcqQuestionId: i.mcqQuestionId, marks: Number(i.marks) })),
    })),
  }
}

/** Quick local hints before saving (the server re-validates everything). */
export function formIssues(form) {
  const issues = []
  if (!form.jobId) issues.push('Choose a job.')
  if (!form.title || form.title.trim().length < 3) issues.push('Add a title (at least 3 characters).')
  const d = Number(form.durationMinutes)
  if (!Number.isInteger(d) || d < 5 || d > 600) issues.push('Duration must be 5-600 minutes.')
  if (form.availableFrom && form.availableUntil && new Date(form.availableUntil) <= new Date(form.availableFrom)) issues.push('Availability must end after it starts.')
  const sectionMinutes = form.sections.filter((s) => s.enabled && s.durationMinutes !== '').reduce((sum, s) => sum + Number(s.durationMinutes), 0)
  if (sectionMinutes > d) issues.push('Section durations add up to more than the total duration.')
  return issues
}

export function totalMarks(form) {
  return form.sections.filter((s) => s.enabled).reduce((sum, s) => sum + s.items.reduce((x, i) => x + Number(i.marks || 0), 0), 0)
}
