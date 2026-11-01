// Turns an Axios error into a short, user-safe message (never the raw response body or stack).
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const msg = err?.response?.data?.message || err?.response?.data?.error
  if (typeof msg === 'string' && msg.length < 300) return msg
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection.'
  return fallback
}
