/**
 * STAR (Situation, Task, Action, Result) only fits questions that ask about a past experience. Showing it under
 * "difference between overloading and overriding" produces misleading "Task: Not found" messages, so it is offered only when
 * the interview is behavioural/HR, or (in a mixed interview) when the question itself asks for a past example.
 */
const PAST_EXPERIENCE = [
  /\b(tell|talk) (me|us) about a (time|situation|project|moment|challenge|mistake|conflict)\b/i,
  /\bdescribe (a|an|the) (time|situation|project|experience|occasion|challenge|conflict)\b/i,
  /\bgive (me|us)? ?(an )?example (of|when|where)\b/i,
  /\b(a|the) time (when|you|that)\b/i,
  /\bhave you (ever|had to)\b/i,
  /\bhow did you (handle|deal|resolve|manage|respond|overcome|approach)\b/i,
  /\bwalk (me|us) through a (project|time|situation)\b/i,
  /\b(conflict|disagreement) (with|you|at)\b/i,
  /\byour (biggest|greatest) (challenge|failure|achievement|mistake)\b/i,
  /\bwhat did you (do|learn)\b/i,
]

export function isPastExperienceQuestion(text) {
  const t = String(text || '')
  return PAST_EXPERIENCE.some((re) => re.test(t))
}

export function shouldOfferStar(interviewType, questionText) {
  if (interviewType === 'technical') return false
  if (interviewType === 'behavioral' || interviewType === 'hr') return true
  return isPastExperienceQuestion(questionText) // mixed, or any unknown type
}
