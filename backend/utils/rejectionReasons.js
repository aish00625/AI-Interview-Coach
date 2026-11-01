/**
 * A rejection must carry one of these structured reasons. `label` is shown to the candidate (it is deliberately
 * neutral and never includes the hiring team's free-text note); `requiresNote` forces an explanation for "other".
 * Assessment scores are advisory inputs for a human; none of these reasons is ever assigned automatically.
 */
const REJECTION_REASONS = {
  skills_mismatch: { label: 'The required skills did not match the role closely enough.', requiresNote: false },
  experience_mismatch: { label: 'The experience level did not match what the role needs.', requiresNote: false },
  assessment_review: { label: 'After reviewing the assessment, the hiring team chose to move forward with other candidates.', requiresNote: false },
  incomplete_application: { label: 'The application did not contain enough information to continue.', requiresNote: false },
  position_filled: { label: 'The position has been filled or is no longer available.', requiresNote: false },
  other: { label: 'The hiring team chose not to continue with this application.', requiresNote: true },
}
const REASON_CODES = Object.keys(REJECTION_REASONS)
const labelFor = (code) => (REJECTION_REASONS[code] ? REJECTION_REASONS[code].label : null)

module.exports = { REJECTION_REASONS, REASON_CODES, labelFor }
