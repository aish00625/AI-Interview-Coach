/**
 * Counts how an answer was typed - never WHAT was typed. Only numbers (key counts, durations, paste size) are kept and
 * sent; key values themselves are discarded immediately, so this is not a keylogger. Used for private practice only; the
 * server re-derives every figure (typing speed, correction ratio, paste share) from these counters and ignores the rest.
 *
 * "Active typing" time is the sum of gaps between key presses that are shorter than LONG_PAUSE_MS. A longer gap is
 * counted as a pause instead, so thinking time does not make the typing speed look slow.
 */
export const LONG_PAUSE_MS = 3000

export function createTypingTracker(now = () => Date.now()) {
  let s
  const reset = () => {
    s = { startedAt: now(), lastKeyAt: null, firstKeyAt: null, keystrokes: 0, typedChars: 0, backspaces: 0, pasteCount: 0, pastedChars: 0, activeTypingMs: 0, longPauseCount: 0, longestPauseMs: 0 }
  }
  reset()

  function onKeyDown(e) {
    if (!e || e.isComposing || e.repeat) return
    const key = e.key
    if (e.ctrlKey || e.metaKey || e.altKey) return                       // shortcuts (copy/paste/select-all) are not typing
    const isChar = typeof key === 'string' && (key.length === 1 || key === 'Enter')
    const isDelete = key === 'Backspace' || key === 'Delete'
    if (!isChar && !isDelete) return                                     // arrows, shift, tab, function keys...
    const t = now()
    if (s.firstKeyAt === null) s.firstKeyAt = t
    if (s.lastKeyAt !== null) {
      const gap = t - s.lastKeyAt
      if (gap >= LONG_PAUSE_MS) {
        s.longPauseCount += 1
        s.longestPauseMs = Math.max(s.longestPauseMs, gap)
      } else s.activeTypingMs += gap
    }
    s.lastKeyAt = t
    s.keystrokes += 1
    if (isDelete) s.backspaces += 1
    else s.typedChars += 1
  }

  function onPaste(pastedLength) {
    s.pasteCount += 1
    s.pastedChars += Math.max(0, Number(pastedLength) || 0)
  }

  /** Plain counters, safe to JSON-serialise. */
  function snapshot() {
    return {
      keystrokes: s.keystrokes, typedChars: s.typedChars, backspaces: s.backspaces,
      pasteCount: s.pasteCount, pastedChars: s.pastedChars,
      activeTypingMs: s.activeTypingMs, totalMs: Math.max(0, now() - s.startedAt),
      timeToFirstKeyMs: s.firstKeyAt === null ? null : s.firstKeyAt - s.startedAt,
      longPauseCount: s.longPauseCount, longestPauseMs: s.longestPauseMs,
    }
  }

  return { onKeyDown, onPaste, snapshot, reset }
}
