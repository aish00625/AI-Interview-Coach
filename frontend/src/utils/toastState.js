/** Pure state logic for toast notifications (kept separate from React so it can be unit-tested). */
export const MAX_TOASTS = 4
export const TOAST_DURATIONS_MS = { success: 5000, info: 6000, warning: 9000, error: 12000 }
export const TOAST_TYPES = Object.keys(TOAST_DURATIONS_MS)

let counter = 0
export function makeToast(type, message, options = {}) {
  const safeType = TOAST_TYPES.includes(type) ? type : 'info'
  counter += 1
  return {
    id: options.id || `t${counter}`,
    type: safeType,
    message: String(message ?? ''),
    title: options.title || null,
    durationMs: Number.isFinite(options.durationMs) ? options.durationMs : TOAST_DURATIONS_MS[safeType],
  }
}

export function toastsReducer(state, action) {
  switch (action.type) {
    case 'add': {
      if (!action.toast.message) return state
      const withoutSame = state.filter((t) => t.id !== action.toast.id && !(t.type === action.toast.type && t.message === action.toast.message))
      return [...withoutSame, action.toast].slice(-MAX_TOASTS)
    }
    case 'dismiss': return state.filter((t) => t.id !== action.id)
    case 'clear': return []
    default: return state
  }
}

/** Errors and warnings interrupt a screen reader (role=alert); success / info are announced politely (role=status). */
export const toastRole = (type) => (type === 'error' || type === 'warning' ? 'alert' : 'status')
