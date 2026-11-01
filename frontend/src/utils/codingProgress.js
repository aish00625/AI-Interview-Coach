/**
 * Solved / attempted standing per coding problem, as shown on the Coding Problems page.
 *
 * GET /api/coding/problems returns each problem's id exactly as PostgreSQL's driver gives a BIGINT column - a STRING
 * ("1") - while GET /api/coding/progress returns problemId as a NUMBER (1). A Map keyed by one and looked up with the
 * other never matches, so every problem looked "Not started" even with a passed submission. Keys are therefore
 * always compared as strings, here and nowhere else. Solved is counted per distinct problem, never per submission.
 */
export function buildProgressMap(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) if (r && r.problemId != null) map.set(String(r.problemId), r)
  return map
}

export function progressFor(map, problemId) {
  return map && problemId != null ? map.get(String(problemId)) : undefined
}

/** 'solved' | 'attempted' | 'new' */
export function statusFor(map, problemId) {
  return progressFor(map, problemId)?.status || 'new'
}

/** How many of the given problems are solved (each problem counted once, however many submissions it has). */
export function countSolved(problems, map) {
  const seen = new Set()
  for (const p of Array.isArray(problems) ? problems : []) if (statusFor(map, p.id) === 'solved') seen.add(String(p.id))
  return seen.size
}
