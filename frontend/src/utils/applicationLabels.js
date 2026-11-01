export const APPLICATION_STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  rejected: 'Not selected',
  hired: 'Hired',
  withdrawn: 'Withdrawn',
}
export const statusLabel = (s) => APPLICATION_STATUS_LABELS[s] || s

export const HIRER_ACTIONS = {
  under_review: 'Start review',
  shortlisted: 'Shortlist',
  rejected: 'Reject',
  hired: 'Mark as hired',
}
