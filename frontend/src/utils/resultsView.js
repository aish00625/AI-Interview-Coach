/**
 * View-models for the per-question results dashboard. Pure functions: they only reorganise numbers the backend already measured
 * and phrase them in plain words. Nothing here invents a measurement, and a missing value is never shown as zero.
 */
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
const n = (v) => Number(v)
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d
const pct = (r) => `${Math.round(n(r) * 100)}%`

export const SCORE_KEYS = [
  ['technical_score', 'Technical'],
  ['relevance_score', 'Relevance'],
  ['clarity_score', 'Clarity'],
  ['completeness_score', 'Completeness'],
]

/* ------------------------------------------------------------------ answer quality (decided by the backend, only displayed here) */

const QUALITY_COPY = {
  not_evaluable: { tone: 'muted', text: 'This answer did not contain enough understandable content to evaluate, so no scores were given.' },
  too_short: { tone: 'warning', text: 'Your answer is understandable but too short to judge reliably. The scores below are rough partial credit.' },
  off_topic: { tone: 'danger', text: 'Your answer did not address the question that was asked, so it earned little credit for content.' },
  insufficient: { tone: 'danger', text: 'Your answer is meaningful, but few of the expected points were found in it.' },
  partial: { tone: 'warning', text: 'Your answer covers some of what was expected. Adding the missing points would raise the scores.' },
  good: { tone: 'success', text: 'Your answer covered most of what was expected.' },
  strong: { tone: 'success', text: 'Your answer covered nearly everything that was expected.' },
  skipped: { tone: 'muted', text: 'You skipped this question, so it counts as 0 in the session score.' },
}

/**
 * The backend's verdict on the answer ("Not evaluable", "Too short ...", ..., "Strong answer"), or null for answers saved before it existed.
 * The status, label and reasons are the backend's; nothing here recomputes or adjusts them.
 */
export function qualityView(answer) {
  const q = answer && answer.evaluation_meta && answer.evaluation_meta.answerQuality
  if (!q || !Object.prototype.hasOwnProperty.call(QUALITY_COPY, q.status)) return null
  const copy = QUALITY_COPY[q.status]
  return {
    status: q.status,
    label: typeof q.label === 'string' && q.label ? q.label : q.status,
    tone: copy.tone,
    text: copy.text,
    evaluable: q.status !== 'not_evaluable' && q.status !== 'skipped',
    skipped: q.status === 'skipped',
    reasons: Array.isArray(q.reasons) ? q.reasons.filter((r) => typeof r === 'string' && r) : [],
    basis: typeof q.scoreBasis === 'string' && q.scoreBasis ? q.scoreBasis : null,
  }
}

/**
 * How many times this question was answered and what the earlier attempts looked like (kept by the backend when an answer is replaced).
 * Returns null for a first attempt. Only reorganises what the backend stored.
 */
export function attemptsView(answer) {
  const meta = (answer && answer.evaluation_meta) || {}
  const count = Number(meta.attemptCount)
  if (!Number.isFinite(count) || count < 2) return null
  const previous = (Array.isArray(meta.previousAttempts) ? meta.previousAttempts : []).filter((p) => p && typeof p === 'object').map((p) => ({
    at: typeof p.at === 'string' ? p.at : null,
    skipped: p.skipped === true,
    average: isNum(p.average) ? round(n(p.average)) : null,
    preview: typeof p.preview === 'string' ? p.preview : '',
  }))
  return { count, previous }
}

/** The four answer scores in display order. A missing one is null, not 0; an answer the backend could not evaluate is "not scored". */
export function answerScores(answer) {
  const notScored = !!(qualityView(answer) && !qualityView(answer).evaluable)
  return SCORE_KEYS.map(([key, label]) => ({ key, label, notScored, value: !notScored && answer && isNum(answer[key]) ? n(answer[key]) : null }))
}

/** Plain average of the four answer scores, only when all four exist. This is a summary of this one answer, not the session's final score. */
export function overallScore(answer) {
  const s = answerScores(answer)
  if (s.some((x) => x.value === null)) return null
  return round(s.reduce((a, x) => a + x.value, 0) / s.length, 0)
}

export function scoreTone(value) {
  if (value === null || value === undefined) return 'muted'
  if (value >= 75) return 'success'
  if (value >= 50) return 'warning'
  return 'danger'
}

/** Headline for the ring, from the score band only. Words describe the answer's score, not the person. */
export function verdict(answer) {
  const score = overallScore(answer)
  const meta = (answer && answer.evaluation_meta) || {}
  const quality = qualityView(answer)
  if (quality) {
    // The backend's status is the headline. The average of the four scores is shown in the ring and is never recomputed from it.
    const ranked = answerScores(answer).filter((x) => x.value !== null).sort((a, b) => b.value - a.value)
    const notes = quality.evaluable && quality.status !== 'too_short' && ranked.length >= 2
      ? [`Strongest: ${ranked[0].label} (${round(ranked[0].value)}). Weakest: ${ranked[ranked.length - 1].label} (${round(ranked[ranked.length - 1].value)}).`] : []
    return { score: quality.evaluable ? score : null, title: quality.label, tone: quality.tone, text: quality.text, notes, status: quality.status }
  }
  const notes = []
  const scores = answerScores(answer).filter((x) => x.value !== null)
  if (scores.length >= 2) {
    const sorted = [...scores].sort((a, b) => b.value - a.value)
    notes.push(`Strongest: ${sorted[0].label} (${round(sorted[0].value)}). Weakest: ${sorted[sorted.length - 1].label} (${round(sorted[sorted.length - 1].value)}).`)
  }
  const noReference = meta.rubricId === null || meta.rubricId === undefined ? (meta.confidence === 'low' || meta.rubricKind === null) : false
  if (meta.confidence === 'low' || noReference) {
    notes.push('The automated check had little to compare this answer against, so treat these scores as rough.')
  }
  if (score === null) return { score: null, title: 'Scores unavailable', tone: 'muted', text: 'This answer has no complete set of scores.', notes }
  const title = score >= 80 ? 'Strong answer' : score >= 60 ? 'Good attempt' : score >= 40 ? 'Partly there' : 'Needs more work'
  const text = score >= 80 ? 'Your answer covered most of what was expected.'
    : score >= 60 ? 'You show a good understanding, but the answer can be improved with more detail and an example.'
      : score >= 40 ? 'Some of the key points were there. Adding the missing ones would raise the score.'
        : 'Few of the expected points were found. Review the ideal answer and try again.'
  return { score, title, tone: scoreTone(score), text, notes }
}

/* ------------------------------------------------------------------ camera */

const LEVEL_WORD = { low: 'Low', moderate: 'Moderate', high: 'High' }
const HEAD_WORD = { low: 'Steady', moderate: 'Moderate', high: 'Active' }
const FRAMING_WORD = { good: 'Good', fair: 'Fair', poor: 'Poor' }

/**
 * Tiles and plain observations from the measured visual signals. Only what was actually measured appears with a value. When the
 * face-landmark model was not available the landmark-based tiles say "Unavailable" instead of disappearing or showing 0.
 * Older saved answers (before these signals existed) simply have fewer tiles.
 */
export function cameraView(cv) {
  if (!cv) return null
  const modelMissing = cv.analysisStatus === 'model_unavailable'
  const tiles = []
  const unavailable = (key, label, hint) => tiles.push({ key, label, value: 'Unavailable', hint, ratio: null, muted: true })

  if (isNum(cv.facePresenceRatio)) tiles.push({ key: 'presence', label: 'Face visibility', value: pct(cv.facePresenceRatio), ratio: n(cv.facePresenceRatio) })
  else if (cv.facePresent !== null && cv.facePresent !== undefined) tiles.push({ key: 'presence', label: 'Face detected', value: cv.facePresent ? 'Yes' : 'No', ratio: null })

  if (isNum(cv.facingCameraRatio)) tiles.push({ key: 'facing', label: 'Facing the camera', value: pct(cv.facingCameraRatio), ratio: n(cv.facingCameraRatio), hint: 'head and eyes toward the lens' })
  else if (modelMissing) unavailable('facing', 'Facing the camera', 'needs the face model')

  const hm = cv.headMovement
  if (hm && hm.level) tiles.push({ key: 'head', label: 'Head movement', value: HEAD_WORD[hm.level] || hm.level, hint: isNum(hm.yawSpread) ? `turn ±${round(n(hm.yawSpread), 1)}°, nod ±${round(n(hm.pitchSpread), 1)}°` : null, ratio: null })
  else if (modelMissing) unavailable('head', 'Head movement', 'needs the face model')

  const ev = cv.expressionVariation
  if (ev && ev.level) tiles.push({ key: 'expression', label: 'Expression variation', value: LEVEL_WORD[ev.level] || ev.level, hint: 'amount of facial movement', ratio: null })
  else if (modelMissing) unavailable('expression', 'Expression variation', 'needs the face model')

  const eye = isNum(cv.eyeContactRatio) ? n(cv.eyeContactRatio) : (isNum(cv.lookingAwayRatio) ? 1 - n(cv.lookingAwayRatio) : null)
  if (eye !== null) tiles.push({ key: 'eye', label: 'Eye contact (approx.)', value: pct(eye), ratio: eye, hint: 'looking toward the camera' })
  else if (modelMissing) unavailable('eye', 'Eye contact (approx.)', 'needs the face model')

  const fr = cv.framing
  if (fr && fr.level) tiles.push({ key: 'framing', label: 'Position in frame', value: FRAMING_WORD[fr.level] || fr.level, hint: 'head position, not body posture', ratio: isNum(fr.wellFramedRatio) ? n(fr.wellFramedRatio) : null })
  else if (modelMissing) unavailable('framing', 'Position in frame', 'needs the face model')

  const obs = []
  if (isNum(cv.facePresenceRatio)) {
    const r = n(cv.facePresenceRatio)
    obs.push(r >= 0.9 ? 'Your face was visible in most of the sampled frames.'
      : r >= 0.6 ? `Your face was visible in about ${pct(r)} of the sampled frames.`
        : 'Your face was out of view in many frames. Check your lighting and where the camera points.')
  }
  if (isNum(cv.facingCameraRatio)) {
    const r = n(cv.facingCameraRatio)
    obs.push(r >= 0.8 ? 'You faced the camera for most of the answer.' : r >= 0.5 ? `You faced the camera for about ${pct(r)} of the answer.` : 'You were turned away from the camera for much of the answer.')
  }
  if (hm && hm.level) obs.push({ low: 'Your head stayed fairly steady.', moderate: 'You moved your head a moderate amount, which is natural when speaking.', high: 'Your head moved a lot during the answer.' }[hm.level])
  if (ev && ev.level) obs.push({ low: 'Your facial expression changed little. This measures movement only, not feelings.', moderate: 'Your face showed some change of expression. This measures movement only, not feelings.', high: 'Your face changed expression often. This measures movement only, not feelings.' }[ev.level])
  if (fr && Array.isArray(fr.hints)) obs.push(...fr.hints.filter((h) => typeof h === 'string'))
  if (modelMissing) obs.push('Head direction, expression and eye contact could not be measured here, only face presence.')
  if (cv.clipTruncated) obs.push('The clip was longer than the analysis limit, so only its first part was analysed.')
  const details = []
  if (cv.headPose && isNum(cv.headPose.yaw)) details.push(`Average head angle: yaw ${round(n(cv.headPose.yaw))}°, pitch ${round(n(cv.headPose.pitch))}°, roll ${round(n(cv.headPose.roll))}°.`)
  if (isNum(cv.averageGazeDeviation)) details.push(`Average gaze offset: ${round(n(cv.averageGazeDeviation), 2)} (0 = centred).`)
  const frames = isNum(cv.framesAnalyzed) ? `${n(cv.framesAnalyzed)} frames analysed${isNum(cv.framesInClip) && n(cv.framesInClip) ? `, sampled from ${n(cv.framesInClip)}` : ''}` : null
  return { tiles, observations: obs.filter(Boolean), details, frames, empty: tiles.length === 0 }
}

/* ------------------------------------------------------------------ signal guide */

const SNAP_CAPTION = {
  framed: 'Your face well placed in the picture', facing: 'Facing the camera', away: 'Turned away from the camera', noface: 'Face out of view',
  turn: 'Largest head turn', expressive: 'Most facial movement', calm: 'Least facial movement',
}

// What each measurement is, in plain words, and which snapshots illustrate it (in this order).
const GUIDE = [
  { key: 'presence', title: 'Face visible', means: 'How much of your answer a face was in the picture. If the camera could not see you, nothing else can be measured.', kinds: ['framed', 'noface'] },
  { key: 'facing', title: 'Facing the camera', means: 'How often your head was pointed toward the camera. Glancing at notes or another screen counts as turned away.', kinds: ['facing', 'away'] },
  { key: 'head', title: 'Head movement', means: 'How much your head moved while you answered: low, moderate or high. Some movement is natural when speaking.', kinds: ['turn'] },
  { key: 'expression', title: 'Expression variation', means: 'How much your face moved: brows, eyes, smile and cheeks. It does not say what you felt and it does not label emotions.', kinds: ['expressive', 'calm'] },
  { key: 'eye', title: 'Eye contact (approximate)', means: 'How often your eyes pointed toward the camera. A webcam only gives a rough estimate, so treat it as a guide.', kinds: ['facing', 'away'] },
  { key: 'framing', title: 'Position in frame', means: 'Whether your head was well placed in the picture: centred, not too small and not too close. It says nothing about your body posture.', kinds: ['framed'] },
]

/**
 * One card per measured signal: what it means, your result, and real frames from your own answer that illustrate it.
 * A snapshot is only ever shown under a signal it really illustrates, and a signal that was not measured gets no card.
 */
export function signalGuide(cv, view = cameraView(cv)) {
  if (!view || view.empty) return []
  const dur = cv && isNum(cv.timeline && cv.timeline.durationSeconds) ? n(cv.timeline.durationSeconds) : null
  const snaps = cv && Array.isArray(cv.snapshots) ? cv.snapshots.filter((x) => x && typeof x.image === 'string' && Array.isArray(x.kinds)) : []
  const at = (t) => (dur && isNum(t) ? `${round(n(t) * dur, 0)}s` : isNum(t) ? `${round(n(t) * 100, 0)}% through` : '')
  const cards = []
  for (const g of GUIDE) {
    const tile = view.tiles.find((x) => x.key === g.key)
    if (!tile || tile.muted) continue
    const shots = []
    for (const kind of g.kinds) {
      const hit = snaps.find((x) => x.kinds.includes(kind))
      if (hit) shots.push({ kind, image: hit.image, caption: SNAP_CAPTION[kind], at: at(hit.t) })
    }
    cards.push({ key: g.key, title: g.title, value: tile.value, means: g.means, shots })
  }
  return cards
}

/* ------------------------------------------------------------------ timeline */

export const TIMELINE_SERIES = [
  { key: 'face', label: 'Face visible', color: 'var(--accent-teal)' },
  { key: 'facing', label: 'Facing camera', color: 'var(--indigo-500)' },
  { key: 'expression', label: 'Facial change', color: 'var(--accent-amber)' },
  { key: 'head', label: 'Head change', color: 'var(--violet-500)' },
]

/**
 * Chart data for the "throughout the answer" timeline. Each series is a list of line segments in 0..1 coordinates (x = position in the
 * answer, y = 0 low .. 1 high). A point that was not measured BREAKS the line instead of being drawn as 0. A series with no measured
 * points at all is dropped, and so is the whole chart when fewer than 3 points exist.
 */
export function timelineView(cv) {
  const tl = cv && cv.timeline
  const pts = tl && Array.isArray(tl.points) ? tl.points.filter((p) => p && isNum(p.t)) : []
  if (pts.length < 3) return null
  const series = []
  for (const def of TIMELINE_SERIES) {
    const segments = []
    let cur = []
    let measured = 0
    for (const p of pts) {
      const v = p[def.key]
      if (v === null || v === undefined || !isNum(v)) { if (cur.length) segments.push(cur); cur = []; continue }
      measured += 1
      cur.push({ x: Math.max(0, Math.min(1, n(p.t))), y: Math.max(0, Math.min(1, n(v))) })
    }
    if (cur.length) segments.push(cur)
    if (measured > 0) series.push({ ...def, segments, measured })
  }
  if (!series.length) return null
  const dur = tl && isNum(tl.durationSeconds) && n(tl.durationSeconds) > 0 ? n(tl.durationSeconds) : null
  const ticks = dur ? [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: f, label: `${round(dur * f, 0)}s` })) : [{ x: 0, label: 'Start' }, { x: 1, label: 'End' }]
  return { series, ticks, durationSeconds: dur }
}

/* ------------------------------------------------------------------ typing */

export function typingView(t) {
  if (!t) return null
  const tiles = []
  if (isNum(t.typingSpeedWpm)) tiles.push({ key: 'wpm', label: 'Typing speed', value: `${round(n(t.typingSpeedWpm))}`, unit: 'WPM' })
  if (isNum(t.longPauseCount)) tiles.push({ key: 'pauses', label: 'Long pauses (3 s+)', value: String(n(t.longPauseCount)) })
  if (isNum(t.longestPauseMs) && n(t.longestPauseMs) > 0) tiles.push({ key: 'longest', label: 'Longest pause', value: `${round(n(t.longestPauseMs) / 1000, 1)}`, unit: 's' })
  if (isNum(t.timeToFirstKeyMs)) tiles.push({ key: 'first', label: 'Time to first key', value: `${round(n(t.timeToFirstKeyMs) / 1000, 1)}`, unit: 's' })
  if (isNum(t.correctionRatio)) tiles.push({ key: 'edits', label: 'Deletions', value: pct(t.correctionRatio), hint: 'of key presses' })
  if (isNum(t.pasteShare) && n(t.pasteShare) > 0) tiles.push({ key: 'paste', label: 'Pasted', value: pct(t.pasteShare), hint: 'of the answer' })

  const obs = []
  if (isNum(t.longPauseCount)) obs.push(n(t.longPauseCount) === 0 ? 'No long pauses while typing.' : `${n(t.longPauseCount)} longer pause${n(t.longPauseCount) === 1 ? '' : 's'} while typing. Pausing to think is normal.`)
  if (isNum(t.correctionRatio)) obs.push(n(t.correctionRatio) >= 0.25 ? 'You edited and deleted quite a bit as you wrote.' : 'You made few corrections while typing.')
  if (isNum(t.pasteShare) && n(t.pasteShare) > 0) obs.push(`About ${pct(t.pasteShare)} of the answer was pasted rather than typed.`)
  if (Array.isArray(t.notes)) obs.push(...t.notes.filter((x) => typeof x === 'string'))
  return { tiles, observations: obs, empty: tiles.length === 0 }
}

/* ------------------------------------------------------------------ model answer */

/** The server's placeholder when no reference answer exists is shown as a note, not as an "ideal answer". */
export function idealAnswer(answer, maxChars = 320) {
  const text = answer && typeof answer.model_answer === 'string' ? answer.model_answer.trim() : ''
  if (!text) return { kind: 'none', text: '', short: '', truncated: false }
  if (/^no reference model answer/i.test(text)) return { kind: 'unavailable', text, short: text, truncated: false }
  const truncated = text.length > maxChars
  return { kind: 'available', text, short: truncated ? `${text.slice(0, maxChars).replace(/\s+\S*$/, '')}…` : text, truncated }
}

/** The answer the person gave: typed text, or the transcript of a spoken answer. */
export function givenAnswer(answer) {
  if (!answer) return { mode: 'none', text: '' }
  if (typeof answer.audio_transcript === 'string' && answer.audio_transcript.trim()) return { mode: 'spoken', text: answer.audio_transcript.trim() }
  if (typeof answer.answer_text === 'string' && answer.answer_text.trim()) return { mode: 'typed', text: answer.answer_text.trim() }
  return { mode: 'none', text: '' }
}
