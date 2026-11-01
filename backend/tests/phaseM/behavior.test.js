// Phase M: typing-metrics sanitiser and the advisory delivery (behaviour) score.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { root } = require('../phaseA/helpers')
const { sanitizeTypingMetrics: san } = require(path.join(root, 'utils/typingMetrics.js'))
const B = require(path.join(root, 'utils/behaviorScoring.js'))

const typed = { keystrokes: 300, typedChars: 280, backspaces: 30, activeTypingMs: 60000, totalMs: 90000, longPauseCount: 2, longestPauseMs: 4200, timeToFirstKeyMs: 3000 }

test('typing speed is derived server-side: (chars/5) / minutes', () => {
  const m = san(typed, 'x'.repeat(260))
  assert.equal(m.typingSpeedWpm, 56); assert.equal(m.correctionRatio, 0.1); assert.equal(m.pasteShare, 0); assert.equal(m.reliable, true)
})

test('client-supplied derived fields and unknown keys are ignored', () => {
  const m = san({ ...typed, typingSpeedWpm: 999, reliable: false, evil: 'x', score: 100 }, 'x'.repeat(260))
  assert.equal(m.typingSpeedWpm, 56); assert.equal(m.evil, undefined); assert.equal(m.score, undefined)
})

test('nothing usable -> null; garbage numbers are clamped, not trusted', () => {
  assert.equal(san(null, 'x'), null); assert.equal(san([], 'x'), null); assert.equal(san({}, 'x'), null); assert.equal(san('str', 'x'), null)
  const m = san({ keystrokes: 1e12, typedChars: -5, backspaces: 1e12, activeTypingMs: 'abc', totalMs: NaN }, 'hello')
  assert.ok(m.keystrokes <= 100000 && m.typedChars === 0 && m.backspaces <= m.keystrokes && m.activeTypingMs === 0)
})

test('too little typing: no speed figure, flagged unreliable with a note', () => {
  const m = san({ keystrokes: 10, typedChars: 10, activeTypingMs: 2000, totalMs: 4000 }, 'short text')
  assert.equal(m.typingSpeedWpm, null); assert.equal(m.reliable, false); assert.ok(m.notes.length >= 1)
})

test('pasted text is measured as a share of the final answer and capped at 1', () => {
  const m = san({ keystrokes: 20, typedChars: 20, pasteCount: 1, pastedChars: 400, activeTypingMs: 8000, totalMs: 9000 }, 'x'.repeat(300))
  assert.equal(m.pasteShare, 1)
})

test('submitted text far longer than the recorded input is flagged (input not captured)', () => {
  const m = san({ ...typed }, 'x'.repeat(2000))
  assert.equal(m.reliable, false); assert.match(m.notes.join(' '), /not captured/)
})

// ---- behaviour score ----
const goodSpeech = { reliable: true, articulationRateWpm: 140, wordCount: 90, disfluencyRatePer100Words: 1, longPauseCount: 0, longestPauseSeconds: 0.9 }

test('score is a weighted mean of measurable components and carries the advisory note', () => {
  const s = B.computeBehaviorSummary({ speechMetrics: goodSpeech })
  assert.equal(s.advisory, true); assert.equal(s.score, 100); assert.deepEqual(s.components.map((c) => c.key), ['pace', 'fluency', 'pausing'])
  assert.match(s.note, /never shown to employers/)
})

test('too fast, many fillers and long pauses lower the score with plain-language details', () => {
  const s = B.computeBehaviorSummary({ speechMetrics: { reliable: true, articulationRateWpm: 230, wordCount: 90, disfluencyRatePer100Words: 12, longPauseCount: 3 } })
  assert.equal(s.components.find((c) => c.key === 'pace').score, 0)
  assert.equal(s.components.find((c) => c.key === 'fluency').score, 0)
  assert.equal(s.components.find((c) => c.key === 'pausing').score, 40)
  assert.equal(s.score, 11) // (0*1 + 0*1 + 40*0.75) / 2.75
})

test('a single signal is not enough for a score; missing inputs are omitted, never scored as 0', () => {
  const s = B.computeBehaviorSummary({ speechMetrics: { reliable: true, wordCount: 5, longPauseCount: 0 } })
  assert.equal(s.score, null); assert.ok(s.limitations.some((l) => /Not enough/.test(l)))
  assert.equal(B.computeBehaviorSummary({}).score, null)
})

test('unreliable speech metrics are not scored', () => {
  const s = B.computeBehaviorSummary({ speechMetrics: { ...goodSpeech, reliable: false }, cvMetrics: { facePresenceRatio: 1, framesAnalyzed: 20 } })
  assert.equal(s.components.some((c) => ['pace', 'fluency', 'pausing'].includes(c.key)), false); assert.equal(s.score, null)
})

test('camera and typing components combine; pasting is described neutrally', () => {
  const cv = { facePresenceRatio: 0.95, framesAnalyzed: 12, lookingAwayRatio: 0.1, framesWithGaze: 10, analysisStatus: 'complete' }
  const s = B.computeBehaviorSummary({ speechMetrics: goodSpeech, cvMetrics: cv })
  assert.ok(s.components.some((c) => c.key === 'presence') && s.components.some((c) => c.key === 'attention')); assert.equal(s.score, 100)
  const t = B.computeBehaviorSummary({ typingMetrics: san({ keystrokes: 100, typedChars: 90, pasteCount: 1, pastedChars: 60, backspaces: 5, activeTypingMs: 40000, totalMs: 50000 }, 'x'.repeat(150)) })
  const o = t.components.find((c) => c.key === 'originality'); assert.ok(o); assert.match(o.detail, /fine when practising/)
})

test('without the landmark model only presence is scored and the limitation is stated', () => {
  const s = B.computeBehaviorSummary({ speechMetrics: goodSpeech, cvMetrics: { facePresenceRatio: 0.9, framesAnalyzed: 10, lookingAwayRatio: null, framesWithGaze: null, analysisStatus: 'model_unavailable' } })
  assert.equal(s.components.some((c) => c.key === 'attention'), false); assert.ok(s.limitations.some((l) => /landmark model/.test(l)))
})

test('the output contains no emotion/personality/honesty language and thresholds are exposed', () => {
  const s = JSON.stringify(B.computeBehaviorSummary({ speechMetrics: goodSpeech }))
  for (const w of ['nervous', 'anxious', 'confident', 'honest', 'lying', 'personality', 'emotion']) assert.ok(!s.toLowerCase().replace(/does not measure confidence, emotion or honesty/, '').includes(w), w)
  assert.ok(B.THRESHOLDS.paceIdealMin < B.THRESHOLDS.paceIdealMax)
})

test('session summary averages answers that have a score', () => {
  assert.deepEqual(B.summarizeSession([{ score: 80 }, { score: 60 }, { score: null }, null]), { score: 70, answersScored: 2, answersTotal: 4, advisory: true })
  assert.equal(B.summarizeSession([null]).score, null)
})
