/** Progress of one interview from the question list the backend returned (each question: { id, answered, answer?.evaluation_meta?.skipped }). */
export function interviewProgress(questions, currentId) {
  const list = Array.isArray(questions) ? questions : []
  const isSkipped = (q) => Boolean(q.answered && q.answer && q.answer.evaluation_meta && q.answer.evaluation_meta.skipped === true)
  const skipped = list.filter(isSkipped).length
  const answered = list.filter((q) => q.answered).length - skipped
  const done = answered + skipped
  const index = list.findIndex((q) => q.id === currentId)
  return {
    total: list.length, answered, skipped, done, remaining: list.length - done,
    position: index === -1 ? null : index + 1,
    percent: list.length ? Math.round((100 * done) / list.length) : 0,
  }
}
