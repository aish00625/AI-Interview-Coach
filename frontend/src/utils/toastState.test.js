import test from 'node:test'
import assert from 'node:assert/strict'
import { makeToast, toastsReducer, toastRole, MAX_TOASTS, TOAST_DURATIONS_MS } from './toastState.js'

test('toasts: types, durations and screen-reader roles', () => {
  for (const type of ['success', 'info', 'warning', 'error']) assert.equal(makeToast(type, 'x').durationMs, TOAST_DURATIONS_MS[type])
  assert.equal(makeToast('weird', 'x').type, 'info')
  assert.equal(makeToast('error', 'x', { durationMs: 0 }).durationMs, 0) // 0 = stays until dismissed
  assert.equal(toastRole('error'), 'alert'); assert.equal(toastRole('warning'), 'alert')
  assert.equal(toastRole('success'), 'status'); assert.equal(toastRole('info'), 'status')
  assert.ok(TOAST_DURATIONS_MS.error > TOAST_DURATIONS_MS.success) // errors stay longer than confirmations
})

test('toast reducer: add, dedupe identical message, cap, dismiss, ignore empty', () => {
  let s = []
  s = toastsReducer(s, { type: 'add', toast: makeToast('success', 'Saved') })
  s = toastsReducer(s, { type: 'add', toast: makeToast('success', 'Saved') })
  assert.equal(s.length, 1)
  for (let i = 0; i < 6; i++) s = toastsReducer(s, { type: 'add', toast: makeToast('info', `n${i}`) })
  assert.equal(s.length, MAX_TOASTS); assert.equal(s[s.length - 1].message, 'n5')
  const id = s[0].id
  assert.equal(toastsReducer(s, { type: 'dismiss', id }).some((t) => t.id === id), false)
  assert.equal(toastsReducer(s, { type: 'add', toast: makeToast('info', '') }).length, s.length)
  assert.deepEqual(toastsReducer(s, { type: 'clear' }), [])
})
