/**
 * Typing-behaviour telemetry for PRIVATE PRACTICE text answers.
 *
 * The browser sends raw counters only (see frontend/src/utils/typingTracker.js). Everything meaningful is DERIVED here on
 * the server from those counters, so a client cannot inject arbitrary fields or pre-computed "scores". No key content is
 * ever sent - only counts and durations - so this is not a keylogger.
 *
 * These are descriptive measurements. They are not evidence of ability, honesty or effort, and they are never used for
 * hiring decisions (they are stored only for practice sessions and never selected by hirer queries).
 */

const SCHEMA_VERSION = 1
const MIN_ACTIVE_MS_FOR_RATE = 5000 // below this a words-per-minute figure is noise
const MIN_CHARS_FOR_RATE = 30
const LONG_PAUSE_MS = 3000

function int(v, max) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.round(n), max)
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/**
 * @param {object} raw     client counters (untrusted)
 * @param {string} finalText the answer text that was actually submitted (trusted - used to cross-check the counters)
 * @returns {object|null}  null when nothing usable was sent
 */
function sanitizeTypingMetrics(raw, finalText) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const finalChars = typeof finalText === 'string' ? finalText.length : 0

  const keystrokes = int(raw.keystrokes, 100000)
  const typedChars = Math.min(int(raw.typedChars, 100000), keystrokes || 100000)
  const pastedChars = int(raw.pastedChars, 100000)
  const pasteCount = int(raw.pasteCount, 1000)
  const backspaces = Math.min(int(raw.backspaces, 100000), keystrokes)
  const activeTypingMs = int(raw.activeTypingMs, 6 * 3600 * 1000)
  const totalMs = Math.max(int(raw.totalMs, 6 * 3600 * 1000), activeTypingMs)
  const timeToFirstKeyMs = raw.timeToFirstKeyMs == null ? null : int(raw.timeToFirstKeyMs, 6 * 3600 * 1000)
  const longPauseCount = int(raw.longPauseCount, 10000)
  const longestPauseMs = int(raw.longestPauseMs, 6 * 3600 * 1000)

  if (keystrokes === 0 && pastedChars === 0) return null

  const notes = []
  const origin = Math.max(typedChars + pastedChars, 1)
  // Counters that cannot be reconciled with the submitted text (e.g. an edit made without key events) are flagged,
  // not hidden: the numbers are still shown but marked less reliable.
  const reconciles = finalChars <= origin * 1.5 + 20
  if (!reconciles) notes.push('The submitted text is longer than the recorded typing, so some input was not captured.')

  const enoughForRate = activeTypingMs >= MIN_ACTIVE_MS_FOR_RATE && typedChars >= MIN_CHARS_FOR_RATE
  const typingSpeedWpm = enoughForRate ? round((typedChars / 5) / (activeTypingMs / 60000), 1) : null
  if (!enoughForRate) notes.push('Too little typing to give a reliable typing speed.')

  const pasteShare = finalChars > 0 ? round(Math.min(pastedChars / finalChars, 1), 3) : null
  const correctionRatio = keystrokes > 0 ? round(backspaces / keystrokes, 3) : null
  const pausesPer100Chars = typedChars >= MIN_CHARS_FOR_RATE ? round((longPauseCount / typedChars) * 100, 2) : null

  return {
    schemaVersion: SCHEMA_VERSION,
    keystrokes,
    typedChars,
    pasteCount,
    pastedChars,
    backspaces,
    finalChars,
    activeTypingMs,
    totalMs,
    timeToFirstKeyMs,
    longPauseCount,
    longestPauseMs,
    typingSpeedWpm,
    correctionRatio,
    pasteShare,
    pausesPer100Chars,
    reliable: enoughForRate && reconciles,
    notes,
  }
}

module.exports = { sanitizeTypingMetrics, SCHEMA_VERSION, LONG_PAUSE_MS }
