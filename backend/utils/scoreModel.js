/**
 * Interview final score for PRACTICE interviews: answer content plus measured delivery signals, as a transparent
 * weighted formula.
 *
 *   applicable categories A = categories that could actually be measured (content is always applicable)
 *   appliedWeight_i  = configuredWeight_i * 100 / sum(configuredWeight_j for j in A)      (so applied weights add to 100)
 *   points_i         = categoryScore_i * appliedWeight_i / 100
 *   finalScore       = sum(points_i)                                                       (0-100, 2 decimals)
 *
 * Categories and default weights (sum 100):
 *   content 70  - technical, relevance, clarity, completeness (equal weights): the existing automated NLP evaluator
 *   speech  12  - speaking pace (articulation rate, which EXCLUDES pauses), filler rate, long pauses
 *   typing  10  - typing speed (active typing time only), corrections, typing continuity, pasted share
 *   camera   8  - EXPERIMENTAL: face visibility, head/gaze direction (needs the optional face-landmark model)
 *
 * Rules (each is covered by tests):
 *   - An unavailable category is reported as unavailable, never scored 0, and its weight is redistributed.
 *   - Correlated signals are not counted twice: pace uses articulation rate (pauses excluded) and pauses carry a small
 *     share inside the speech category; typing speed uses active typing time and continuity carries a small share.
 *   - Camera is noisy: a clip where a face was found in < 25% of frames (usually lighting / camera position) is not
 *     scored at all, and the camera weight is capped (CAMERA_MAX_WEIGHT) while content has a floor (CONTENT_MIN_WEIGHT).
 *   - Only measured counts/timings/ratios and the rule-based evaluator feed the score. AI-written text (follow-ups, STAR
 *     coaching, reports) never does. Nothing here infers confidence, honesty, personality or emotion.
 *   - Coding results are not touched by any of this.
 */
const VERSION = 1
const DEFAULT_WEIGHTS = { content: 70, speech: 12, typing: 10, camera: 8 }
const CONTENT_MIN_WEIGHT = 50
const CAMERA_MAX_WEIGHT = 15
const MIN_FACE_PRESENCE = 0.25

const CATEGORY_META = {
  content: { label: 'Answer content', kind: 'automated_evaluation', experimental: false, note: 'Rule-based NLP evaluator (concept matching and text similarity). Not a language model.' },
  speech: { label: 'Speaking delivery', kind: 'measured', experimental: false, note: 'Measured from the voice recording: pace, filler words and pauses.' },
  typing: { label: 'Typing behaviour', kind: 'measured', experimental: false, note: 'Measured from key timings and counts (never which keys).' },
  camera: { label: 'Camera behaviour', kind: 'measured', experimental: true, note: 'Experimental. Noisy practice signal (lighting, camera angle, glasses). Not a measure of ability, confidence, honesty, personality or emotion.' },
}

// Share of each component inside its category (renormalised over the components that were measured).
const COMPONENT_WEIGHTS = {
  speech: { pace: 0.4, fluency: 0.35, pausing: 0.25 },
  typing: { typingPace: 0.3, editing: 0.25, continuity: 0.2, originality: 0.25 },
  camera: { presence: 0.5, attention: 0.5 },
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const round2 = (n) => Math.round(n * 100) / 100
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Reads SCORE_WEIGHT_{CONTENT,SPEECH,TYPING,CAMERA} (percent-like numbers). Invalid or unsafe settings fall back to the defaults. */
function loadWeights(env = process.env) {
  const keys = Object.keys(DEFAULT_WEIGHTS)
  const raw = {}
  let any = false
  for (const k of keys) {
    const v = env[`SCORE_WEIGHT_${k.toUpperCase()}`]
    if (v !== undefined && String(v).trim() !== '') { any = true; raw[k] = Number(v) } else raw[k] = DEFAULT_WEIGHTS[k]
  }
  if (!any) return { weights: { ...DEFAULT_WEIGHTS }, source: 'default', warnings: [] }
  const fallback = (why) => ({ weights: { ...DEFAULT_WEIGHTS }, source: 'default', warnings: [`SCORE_WEIGHT_* ignored (${why}); default weights used.`] })
  if (keys.some((k) => !Number.isFinite(raw[k]) || raw[k] < 0)) return fallback('every weight must be a number >= 0')
  const sum = keys.reduce((s, k) => s + raw[k], 0)
  if (sum <= 0) return fallback('weights add up to 0')
  const weights = {}
  for (const k of keys) weights[k] = round2((raw[k] * 100) / sum) // normalised so they add up to 100%
  if (weights.content < CONTENT_MIN_WEIGHT) return fallback(`content must be at least ${CONTENT_MIN_WEIGHT}%`)
  if (weights.camera > CAMERA_MAX_WEIGHT) return fallback(`camera may be at most ${CAMERA_MAX_WEIGHT}%`)
  const warnings = Math.abs(sum - 100) > 0.01 ? [`SCORE_WEIGHT_* added up to ${round2(sum)}, so they were scaled to 100%.`] : []
  return { weights, source: 'configured', warnings }
}

/**
 * @param {Array<{ technical:number, relevance:number, clarity:number, completeness:number, behavior?:{components:Array}, flags?:object, cv?:object }>} answers
 *   flags: { hasSpeech, hasTyping, hasCamera } - whether any measurement object was stored (used only for the "why unavailable" text)
 */
function computeScoreBreakdown(answers, { weights = DEFAULT_WEIGHTS, warnings = [], source = 'default' } = {}) {
  const total = answers.length
  const subs = ['technical', 'relevance', 'clarity', 'completeness']
  const perAnswerContent = answers.map((a) => mean(subs.map((k) => Number(a[k]))))
  const contentScore = total ? round2(mean(perAnswerContent)) : 0
  const contentSubs = subs.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), score: total ? round2(mean(answers.map((a) => Number(a[k])))) : 0 }))

  const categories = [{
    key: 'content', ...CATEGORY_META.content, configuredWeight: weights.content, status: 'measured', reason: null, score: contentScore,
    coverage: { answersMeasured: total, answersTotal: total }, components: contentSubs.map((c) => ({ ...c, share: 0.25 })),
  }]

  for (const key of ['speech', 'typing', 'camera']) {
    const shares = COMPONENT_WEIGHTS[key]
    const perAnswer = []
    const comps = new Map()
    let flagged = 0
    let lowFace = 0
    for (const a of answers) {
      if (a.flags && a.flags[key === 'speech' ? 'hasSpeech' : key === 'typing' ? 'hasTyping' : 'hasCamera']) flagged++
      if (key === 'camera' && a.cv && isNum(a.cv.facePresenceRatio) && a.cv.facePresenceRatio < MIN_FACE_PRESENCE) { lowFace++; continue } // lighting / camera position: not scored
      const mine = ((a.behavior && a.behavior.components) || []).filter((c) => shares[c.key] !== undefined && isNum(c.score))
      if (!mine.length) continue
      const w = mine.reduce((s, c) => s + shares[c.key], 0)
      perAnswer.push(mine.reduce((s, c) => s + c.score * shares[c.key], 0) / w)
      for (const c of mine) {
        const e = comps.get(c.key) || { key: c.key, label: c.label, scores: [], worst: null }
        e.scores.push(c.score)
        if (!e.worst || c.score < e.worst.score) e.worst = c
        comps.set(c.key, e)
      }
    }
    const measured = perAnswer.length > 0
    let reason = null
    if (!measured) {
      if (key === 'speech') reason = flagged ? 'Voice measurements were too short or unreliable to score.' : 'No voice answers in this interview.'
      else if (key === 'typing') reason = flagged ? 'Too little typing to measure reliably.' : 'No typed answers in this interview.'
      else if (lowFace) reason = 'A face was found in under 25% of camera frames (usually lighting or camera position), so the camera was not scored.'
      else reason = flagged ? 'Camera clips had too few usable frames, or analysis was unavailable.' : 'The camera was off or no clip was recorded.'
    }
    categories.push({
      key, ...CATEGORY_META[key], configuredWeight: weights[key], status: measured ? 'measured' : 'unavailable', reason,
      score: measured ? round2(mean(perAnswer)) : null,
      coverage: { answersMeasured: perAnswer.length, answersTotal: total },
      components: [...comps.values()].map((e) => ({ key: e.key, label: e.label, score: round2(mean(e.scores)), share: shares[e.key], measuredExample: e.worst.detail })),
      ...(key === 'camera' && measured && !comps.has('attention') ? { limitation: 'Head and gaze direction were not measured (needs the optional face-landmark model); only face visibility was used.' } : {}),
    })
  }

  const applicable = categories.filter((c) => c.status === 'measured' && c.configuredWeight > 0)
  const sumW = applicable.reduce((s, c) => s + c.configuredWeight, 0)
  let finalScore = 0
  for (const c of categories) {
    const on = applicable.includes(c)
    c.appliedWeight = on ? round2((c.configuredWeight * 100) / sumW) : 0
    c.points = on ? round2((c.score * c.appliedWeight) / 100) : null
    if (c.status === 'measured' && c.configuredWeight === 0) { c.status = 'disabled'; c.reason = 'Weight is set to 0 in the scoring configuration.' }
    if (on) finalScore += (c.score * c.appliedWeight) / 100
  }
  return {
    version: VERSION,
    formula: 'applied weight = configured weight / sum of configured weights of the categories that could be measured; points = category score x applied weight; final score = sum of points.',
    weightsSource: source,
    warnings,
    configuredWeights: { ...weights },
    contentScore,
    finalScore: round2(finalScore),
    categories,
    notes: [
      'Unavailable signals are not scored as zero; their weight moves to the categories that were measured.',
      'AI-written feedback (follow-ups, STAR coaching, reports) is not part of the score.',
      'Coding results are scored separately, only from test results.',
    ],
  }
}

module.exports = { computeScoreBreakdown, loadWeights, DEFAULT_WEIGHTS, COMPONENT_WEIGHTS, CONTENT_MIN_WEIGHT, CAMERA_MAX_WEIGHT, MIN_FACE_PRESENCE, VERSION }
