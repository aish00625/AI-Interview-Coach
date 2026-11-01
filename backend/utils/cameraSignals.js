/**
 * The derived camera signals the AI service returns for an answer (facing/eye-contact ratios, head movement, expression variation,
 * position in frame, timeline). They are display-only: nothing here feeds a score. Whatever arrives is clamped and whitelisted
 * before it is stored, so a buggy or compromised AI service cannot put arbitrary or oversized JSON into the database.
 * Anything malformed becomes null ("not measured"), never 0.
 */
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null)
const ratio = (v) => num(v, 0, 1)
const oneOf = (v, allowed) => (allowed.includes(v) ? v : null)
const round = (v, d) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)
const frames = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 100000) : null)

const MAX_POINTS = 60
const MAX_SNAPSHOTS = 7
const MAX_SNAPSHOT_CHARS = 90000 // a 320px JPEG is ~10-20k characters as base64; anything much bigger is not what the service sends
const SNAPSHOT_KINDS = ['framed', 'facing', 'away', 'noface', 'turn', 'expressive', 'calm']
const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/
const MAX_HINTS = 4

function headMovement(h) {
  if (!h || typeof h !== 'object') return null
  const level = oneOf(h.level, ['low', 'moderate', 'high'])
  if (!level) return null
  return {
    level, yawSpread: round(num(h.yawSpread, 0, 360), 1), pitchSpread: round(num(h.pitchSpread, 0, 360), 1), rollSpread: round(num(h.rollSpread, 0, 360), 1),
    meanChangeDeg: round(num(h.meanChangeDeg, 0, 360), 1), framesMeasured: frames(h.framesMeasured),
  }
}

function expressionVariation(e) {
  if (!e || typeof e !== 'object') return null
  const level = oneOf(e.level, ['low', 'moderate', 'high'])
  if (!level) return null
  return { level, spread: round(num(e.spread, 0, 1), 4), framesMeasured: frames(e.framesMeasured) }
}

function framing(f) {
  if (!f || typeof f !== 'object') return null
  const level = oneOf(f.level, ['good', 'fair', 'poor'])
  if (!level) return null
  const hints = Array.isArray(f.hints) ? f.hints.filter((h) => typeof h === 'string').map((h) => h.slice(0, 160)).slice(0, MAX_HINTS) : []
  return {
    level, wellFramedRatio: round(ratio(f.wellFramedRatio), 3), meanFaceHeight: round(ratio(f.meanFaceHeight), 3),
    meanCentreX: round(ratio(f.meanCentreX), 3), meanCentreY: round(ratio(f.meanCentreY), 3), hints, framesMeasured: frames(f.framesMeasured),
  }
}

function timeline(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.points)) return null
  const bin = (v) => (v === 0 || v === 1 ? v : null)
  const points = t.points.slice(0, MAX_POINTS).map((p) => {
    if (!p || typeof p !== 'object') return null
    const at = ratio(p.t)
    if (at === null) return null
    return { t: round(at, 4), face: bin(p.face), facing: bin(p.facing), expression: round(ratio(p.expression), 3), head: round(ratio(p.head), 3) }
  }).filter(Boolean)
  if (points.length === 0) return null
  return { points, durationSeconds: round(num(t.durationSeconds, 0, 86400), 1) }
}

/** Real frames from the answer video. Only small JPEG data URIs with known labels survive; stored for practice interviews only. */
function snapshots(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (const s of list.slice(0, MAX_SNAPSHOTS)) {
    if (!s || typeof s !== 'object') continue
    const at = ratio(s.t)
    const kinds = Array.isArray(s.kinds) ? [...new Set(s.kinds.filter((k) => SNAPSHOT_KINDS.includes(k)))] : []
    if (at === null || kinds.length === 0) continue
    if (typeof s.image !== 'string' || s.image.length > MAX_SNAPSHOT_CHARS || !JPEG_DATA_URI.test(s.image)) continue
    out.push({ t: round(at, 4), kinds, image: s.image })
  }
  return out.length ? out : null
}

function sanitizeCameraSignals(data, { keepSnapshots = true } = {}) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    eyeContactRatio: round(ratio(d.eyeContactRatio), 3),
    facingCameraRatio: round(ratio(d.facingCameraRatio), 3),
    headMovement: headMovement(d.headMovement),
    expressionVariation: expressionVariation(d.expressionVariation),
    framing: framing(d.framing),
    timeline: timeline(d.timeline),
    snapshots: keepSnapshots ? snapshots(d.snapshots) : null,
  }
}

module.exports = { sanitizeCameraSignals, MAX_POINTS, MAX_SNAPSHOTS, SNAPSHOT_KINDS }
