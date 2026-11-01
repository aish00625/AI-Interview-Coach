/**
 * Scoring policy for analytics (dashboard, topic map, recommendations, previous-attempt comparison):
 *  - a SKIPPED answer and a NOT-EVALUABLE answer carry zero scores that mean "no evidence", not "scored and found wrong";
 *  - they are therefore left out of per-dimension averages and topic averages (shown as "Not answered" / "Insufficient data");
 *  - they still count as zero in the interview's FINAL score (computed elsewhere, unchanged).
 * Legacy rows without evaluation_meta count as evaluated. No migration is needed: the flags already live in evaluation_meta.
 */
function evaluatedAnswerSql(alias = 'ia') {
  return `(COALESCE((${alias}.evaluation_meta->>'skipped')::boolean, false) = false `
    + `AND COALESCE(${alias}.evaluation_meta->'answerQuality'->>'status', '') <> 'not_evaluable')`
}

/** Same rule for an in-memory answer row. */
function isEvaluatedAnswer(row) {
  const meta = (row && row.evaluation_meta) || {}
  if (meta.skipped === true) return false
  const status = meta.answerQuality && meta.answerQuality.status
  return status !== 'not_evaluable' && status !== 'skipped'
}

module.exports = { evaluatedAnswerSql, isEvaluatedAnswer }
