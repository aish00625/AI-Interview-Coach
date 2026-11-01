/**
 * The wording a candidate agrees to when sharing data with a hiring team. Keep in step with CONSENT_VERSION
 * (backend/services/applicationService.js): change the wording => bump the version.
 */
export const CONSENT_RESUME_TEXT = 'I agree to share my profile, my chosen resume and my cover note with this organization\'s hiring team for this application.'
export const CONSENT_ASSESSMENT_TEXT = 'I agree to share my answers, code and automated scores from this job\'s assessments with the hiring team. (Assessments cannot be started without this.)'

export default function ConsentNotice() {
  return (
    <p style={{ color: 'var(--text-500)', fontSize: 13, margin: '8px 0' }}>
      Your private practice sessions are never shared. Hiring team members who open your resume or assessment results are recorded, and you can see
      that record on your application page. Withdrawing the application ends sharing. You can export or delete your data from Account.
    </p>
  )
}
