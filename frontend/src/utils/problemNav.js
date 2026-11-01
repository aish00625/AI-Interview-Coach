/** Previous / next problem from the real, server-ordered problem list (GET /coding/problems is ordered by id). Nothing is hardcoded. */
export function problemNeighbours(problems, currentId) {
  const list = Array.isArray(problems) ? problems : []
  const index = list.findIndex((p) => String(p.id) === String(currentId))
  if (index === -1) return { index: -1, total: list.length, prev: null, next: null }
  return {
    index, total: list.length,
    prev: index > 0 ? list[index - 1] : null,
    next: index < list.length - 1 ? list[index + 1] : null,
  }
}
