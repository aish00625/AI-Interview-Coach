/**
 * Delivery ("behaviour") score - an ADVISORY practice aid, deliberately separate from the content score.
 *
 * What it is: a 0-100 summary of a few MEASURABLE delivery signals (speaking pace, filler/disfluency rate, long pauses,
 * on-camera presence and gaze, typing pace, corrections, pasting). Each signal becomes a 0-100 component with a short
 * human-readable detail; the delivery score is the weighted mean of the components that could actually be measured.
 *
 * What it is NOT:
 *  - feeds the practice interview final score only through utils/scoreModel.js (transparent weights, unavailable signals renormalised);
 *  - not an emotion, confidence, honesty or personality inference - only counts, durations and ratios are used;
 *  - not validated against outcomes. The thresholds below are plain rules of thumb for practice feedback, chosen by the
 *    developers, not derived from research data. They are exported (THRESHOLDS) so they are visible and testable;
 *  - never shown to hirers and never used to reject, rank or filter anyone.
 * A component is omitted (not scored as 0) whenever its input is missing or flagged unreliable, and the score is
 * `null` unless at least two components were measurable.
 */

const VERSION = 1

const THRESHOLDS = {
  // spoken pace, words per minute (articulation rate when available): comfortable band scores 100, falls linearly to 0
  paceIdealMin: 110, paceIdealMax: 170, paceZeroLow: 60, paceZeroHigh: 230,
  // disfluencies per 100 spoken words
  disfluencyFull: 2, disfluencyZero: 12,
  // long pauses (>= 2 s) in a spoken answer: each costs 20 points
  pausePenaltyEach: 20,
  // camera
  presenceFull: 0.9, presenceZero: 0.4,
  lookAwayFull: 0.15, lookAwayZero: 0.6,
  // typing
  typingIdealMin: 25, typingIdealMax: 80, typingZeroLow: 8, typingZeroHigh: 140,
  correctionFull: 0.12, correctionZero: 0.4,
  pausesPer100Full: 0.5, pausesPer100Zero: 4,
  pasteFull: 0.1, pasteZero: 0.8,
}

const WEIGHTS = { pace: 1, fluency: 1, pausing: 0.75, presence: 0.75, attention: 0.5, typingPace: 0.75, editing: 0.5, continuity: 0.75, originality: 0.75 }

const clamp = (n) => Math.max(0, Math.min(100, n))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const r1 = (n) => Math.round(n * 10) / 10

/** 100 inside [idealMin, idealMax], linear down to 0 at zeroLow / zeroHigh. */
function band(v, zeroLow, idealMin, idealMax, zeroHigh) {
  if (v >= idealMin && v <= idealMax) return 100
  if (v < idealMin) return clamp(((v - zeroLow) / (idealMin - zeroLow)) * 100)
  return clamp(((zeroHigh - v) / (zeroHigh - idealMax)) * 100)
}
/** 100 when v <= full, 0 when v >= zero, linear between (lower is better). */
const lowerBetter = (v, full, zero) => (v <= full ? 100 : v >= zero ? 0 : clamp(((zero - v) / (zero - full)) * 100))
/** 100 when v >= full, 0 when v <= zero (higher is better). */
const higherBetter = (v, full, zero) => (v >= full ? 100 : v <= zero ? 0 : clamp(((v - zero) / (full - zero)) * 100))

function speechComponents(m) {
  if (!m || typeof m !== 'object' || m.reliable === false) return { components: [], limits: m && m.reliable === false ? ['Speech measurements were marked unreliable for this recording, so they were not scored.'] : [] }
  const T = THRESHOLDS
  const out = []
  const limits = []
  const rate = isNum(m.articulationRateWpm) ? m.articulationRateWpm : isNum(m.speakingRateWpm) ? m.speakingRateWpm : null
  if (rate !== null) {
    out.push({ key: 'pace', label: 'Speaking pace', score: Math.round(band(rate, T.paceZeroLow, T.paceIdealMin, T.paceIdealMax, T.paceZeroHigh)), detail: `${Math.round(rate)} words per minute (comfortable range ${T.paceIdealMin}-${T.paceIdealMax}).` })
  } else limits.push('Speaking pace needs a longer answer to measure.')
  if (isNum(m.disfluencyRatePer100Words) && m.wordCount >= 20) {
    out.push({ key: 'fluency', label: 'Fluency (fillers)', score: Math.round(lowerBetter(m.disfluencyRatePer100Words, T.disfluencyFull, T.disfluencyZero)), detail: `${r1(m.disfluencyRatePer100Words)} filler words / false starts per 100 words.` })
  } else limits.push('Filler-word rate needs at least 20 spoken words.')
  if (isNum(m.longPauseCount)) {
    out.push({ key: 'pausing', label: 'Long pauses', score: Math.round(clamp(100 - m.longPauseCount * T.pausePenaltyEach)), detail: m.longPauseCount === 0 ? 'No long pauses.' : `${m.longPauseCount} pause${m.longPauseCount === 1 ? '' : 's'} of two seconds or more${isNum(m.longestPauseSeconds) ? ` (longest ${r1(m.longestPauseSeconds)} s)` : ''}.` })
  }
  return { components: out, limits }
}

function cameraComponents(cv) {
  if (!cv || typeof cv !== 'object') return { components: [], limits: [] }
  const T = THRESHOLDS
  const out = []
  const limits = []
  if (isNum(cv.facePresenceRatio) && cv.framesAnalyzed >= 5) {
    out.push({ key: 'presence', label: 'On-camera presence', score: Math.round(higherBetter(cv.facePresenceRatio, T.presenceFull, T.presenceZero)), detail: `Face visible in ${Math.round(cv.facePresenceRatio * 100)}% of ${cv.framesAnalyzed} sampled frames.` })
  } else limits.push('Too few camera frames to measure presence.')
  if (isNum(cv.lookingAwayRatio) && cv.framesWithGaze >= 5) {
    out.push({ key: 'attention', label: 'Facing the camera', score: Math.round(lowerBetter(cv.lookingAwayRatio, T.lookAwayFull, T.lookAwayZero)), detail: `Head or gaze turned away in ${Math.round(cv.lookingAwayRatio * 100)}% of measurable frames.` })
  } else if (cv.analysisStatus === 'model_unavailable') limits.push('Head and gaze direction need the optional face-landmark model; only presence was measured.')
  return { components: out, limits }
}

function typingComponents(t) {
  if (!t || typeof t !== 'object') return { components: [], limits: [] }
  const T = THRESHOLDS
  const out = []
  const limits = []
  if (t.reliable === false) limits.push('Typing measurements were marked unreliable (too little typing, or input that was not captured).')
  if (isNum(t.typingSpeedWpm) && t.reliable !== false) {
    out.push({ key: 'typingPace', label: 'Typing pace', score: Math.round(band(t.typingSpeedWpm, T.typingZeroLow, T.typingIdealMin, T.typingIdealMax, T.typingZeroHigh)), detail: `${r1(t.typingSpeedWpm)} words per minute while typing.` })
  }
  if (isNum(t.correctionRatio) && t.keystrokes >= 30) {
    out.push({ key: 'editing', label: 'Corrections', score: Math.round(lowerBetter(t.correctionRatio, T.correctionFull, T.correctionZero)), detail: `${Math.round(t.correctionRatio * 100)}% of key presses were deletions.` })
  }
  if (isNum(t.pausesPer100Chars)) {
    out.push({ key: 'continuity', label: 'Typing continuity', score: Math.round(lowerBetter(t.pausesPer100Chars, T.pausesPer100Full, T.pausesPer100Zero)), detail: `${t.longPauseCount} pause${t.longPauseCount === 1 ? '' : 's'} of three seconds or more${t.longestPauseMs ? ` (longest ${r1(t.longestPauseMs / 1000)} s)` : ''}.` })
  }
  if (isNum(t.pasteShare)) {
    out.push({ key: 'originality', label: 'Typed vs pasted', score: Math.round(lowerBetter(t.pasteShare, T.pasteFull, T.pasteZero)), detail: t.pasteShare === 0 ? 'Everything was typed in the answer box.' : `${Math.round(t.pasteShare * 100)}% of the answer was pasted. (Pasting is fine when practising - this only describes how the answer was entered.)` })
  }
  return { components: out, limits }
}

/**
 * @param {{ speechMetrics?: object, cvMetrics?: object, typingMetrics?: object }} signals one answer's stored measurements
 */
function computeBehaviorSummary({ speechMetrics, cvMetrics, typingMetrics } = {}) {
  const parts = [speechComponents(speechMetrics), cameraComponents(cvMetrics), typingComponents(typingMetrics)]
  const components = parts.flatMap((p) => p.components)
  const limitations = parts.flatMap((p) => p.limits)
  const totalWeight = components.reduce((s, c) => s + WEIGHTS[c.key], 0)
  const enough = components.length >= 2
  const score = enough ? Math.round(components.reduce((s, c) => s + c.score * WEIGHTS[c.key], 0) / totalWeight) : null
  if (!enough) limitations.push('Not enough measurable delivery signals for a delivery score on this answer.')
  return {
    version: VERSION,
    advisory: true,
    score,
    components: components.map((c) => ({ ...c, weight: WEIGHTS[c.key] })),
    limitations,
    note: 'Delivery feedback is based on counts and timings only. It does not measure confidence, emotion or honesty, and is never shown to employers.',
  }
}

/** Mean delivery score over answers that have one; null when none do. */
function summarizeSession(answerSummaries) {
  const scored = answerSummaries.filter((s) => s && isNum(s.score))
  if (!scored.length) return { score: null, answersScored: 0, answersTotal: answerSummaries.length }
  const score = Math.round(scored.reduce((s, x) => s + x.score, 0) / scored.length)
  const components = rollUpComponents(scored)
  return { score, answersScored: scored.length, answersTotal: answerSummaries.length, advisory: true, ...(components.length ? { components } : {}) }
}

/**
 * Mean score per measurable component across answers, plus the detail line of the weakest answer for that component so
 * the text always points at a real measurement ("Face visible in 62% of 40 sampled frames."), never a generalisation.
 */
function rollUpComponents(scored) {
  const byKey = new Map()
  for (const s of scored) {
    for (const c of s.components || []) {
      if (!isNum(c.score)) continue
      const e = byKey.get(c.key) || { key: c.key, label: c.label, scores: [], worst: null }
      e.scores.push(c.score)
      if (!e.worst || c.score < e.worst.score) e.worst = c
      byKey.set(c.key, e)
    }
  }
  return [...byKey.values()].map((e) => ({
    key: e.key, label: e.label, score: Math.round(e.scores.reduce((a, b) => a + b, 0) / e.scores.length),
    answers: e.scores.length, weakestDetail: e.worst.detail,
  }))
}

module.exports = { computeBehaviorSummary, summarizeSession, THRESHOLDS, WEIGHTS, VERSION }
