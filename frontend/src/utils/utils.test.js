// Run with:  npm test   (node's built-in runner; no extra dependencies)
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTypingTracker, LONG_PAUSE_MS } from './typingTracker.js'
import { describeAiError } from './aiErrors.js'

function clock(start = 1000) { let t = start; const f = () => t; f.advance = (ms) => { t += ms }; return f }
const key = (k, extra = {}) => ({ key: k, ...extra })

test('counts typed characters, deletions and active time; short gaps are active, long gaps are pauses', () => {
  const now = clock(); const tr = createTypingTracker(now)
  now.advance(2000); tr.onKeyDown(key('h'))
  now.advance(200); tr.onKeyDown(key('i'))
  now.advance(300); tr.onKeyDown(key('Backspace'))
  now.advance(LONG_PAUSE_MS + 1500); tr.onKeyDown(key('o'))
  now.advance(100)
  const s = tr.snapshot()
  assert.deepEqual([s.keystrokes, s.typedChars, s.backspaces], [4, 3, 1])
  assert.equal(s.activeTypingMs, 500); assert.equal(s.longPauseCount, 1); assert.equal(s.longestPauseMs, LONG_PAUSE_MS + 1500)
  assert.equal(s.timeToFirstKeyMs, 2000); assert.equal(s.totalMs, 2000 + 200 + 300 + LONG_PAUSE_MS + 1500 + 100)
})

test('shortcuts, modifier keys, arrows, key repeat and IME composition are ignored; Enter counts as a character', () => {
  const tr = createTypingTracker(clock())
  for (const e of [key('v', { ctrlKey: true }), key('c', { metaKey: true }), key('Shift'), key('ArrowLeft'), key('Tab'), key('a', { repeat: true }), key('a', { isComposing: true })]) tr.onKeyDown(e)
  assert.equal(tr.snapshot().keystrokes, 0)
  tr.onKeyDown(key('Enter')); assert.equal(tr.snapshot().typedChars, 1)
})

test('paste is counted by size; the snapshot never contains key values', () => {
  const tr = createTypingTracker(clock())
  tr.onPaste(120); tr.onPaste(-5); tr.onPaste('x')
  tr.onKeyDown(key('secret'.charAt(0)))
  const s = tr.snapshot()
  assert.deepEqual([s.pasteCount, s.pastedChars], [3, 120])
  assert.ok(Object.values(s).every((v) => v === null || typeof v === 'number'))
})

test('reset starts a fresh measurement for the next question', () => {
  const now = clock(); const tr = createTypingTracker(now)
  tr.onKeyDown(key('a')); now.advance(500); tr.reset()
  const s = tr.snapshot(); assert.deepEqual([s.keystrokes, s.totalMs, s.timeToFirstKeyMs], [0, 0, null])
})

const err = (status, data) => ({ response: { status, data } })
test('describeAiError: known reasons give specific guidance and retry hints', () => {
  const a = describeAiError(err(503, { reason: 'speech_model_loading', retryable: true }), 'x')
  assert.equal(a.retryable, true); assert.match(a.message, /still starting up/)
  const b = describeAiError(err(503, { reason: 'speech_package_missing', retryable: false }), 'x')
  assert.equal(b.retryable, false); assert.match(b.message, /requirements-speech\.txt/)
  assert.match(describeAiError(err(422, { reason: 'no_speech_detected' }), 'x').message, /No speech/)
})

test('describeAiError: unknown reason falls back to the safe backend message, then to the fallback', () => {
  assert.equal(describeAiError(err(503, { reason: 'brand_new', message: 'Backend says hi', retryable: true }), 'fb').message, 'Backend says hi')
  assert.equal(describeAiError(err(503, { reason: 'brand_new', retryable: true }), 'fb').retryable, true)
  assert.equal(describeAiError(err(500, {}), 'fb').message, 'fb')
  assert.equal(describeAiError({ code: 'ERR_NETWORK' }, 'fb').reason, 'network')
  assert.match(describeAiError(err(409, {}), 'fb').message, /already been answered/)
})
