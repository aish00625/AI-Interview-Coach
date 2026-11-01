/**
 * Answer-quality statuses reported by the AI service evaluator (see ai-service/app/services/answer_quality.py).
 * The label shown to users is chosen HERE from the status, never taken from a response or a stored row.
 */
const ANSWER_QUALITY_LABELS = {
  not_evaluable: 'Not evaluable',
  too_short: 'Too short to evaluate reliably',
  off_topic: "Doesn't address the question",
  insufficient: 'Meaningful but insufficient',
  partial: 'Partially complete',
  good: 'Good answer',
  strong: 'Strong answer',
  skipped: 'Skipped',
}

/**
 * What a hiring team may see about how reliable an answer's scores are: the status, its label and whether confidence is low. The two
 * inputs are the only fields the hirer queries extract from the stored evaluation; nothing else (criteria lists, follow-up prompts,
 * coaching text) is read or passed on. Null for answers evaluated before the status existed.
 */
function hirerQuality(status, confidence, attemptCount = null) {
  if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(ANSWER_QUALITY_LABELS, status)) return null
  const attempts = Number.isInteger(Number(attemptCount)) && Number(attemptCount) > 1 ? Math.min(Number(attemptCount), 99) : 1
  return {
    status, label: ANSWER_QUALITY_LABELS[status], evaluable: status !== 'not_evaluable' && status !== 'skipped',
    skipped: status === 'skipped', lowConfidence: confidence === 'low', attempts,
  }
}

module.exports = { ANSWER_QUALITY_LABELS, hirerQuality }
