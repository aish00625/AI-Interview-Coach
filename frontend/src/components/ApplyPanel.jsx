import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import { resumeApi, applicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import ConsentNotice, { CONSENT_RESUME_TEXT, CONSENT_ASSESSMENT_TEXT } from './ConsentNotice.jsx'

/** Apply-to-job form shown on the job detail page. Server enforces job openness, eligibility and resume ownership. */
export default function ApplyPanel({ jobId, onApplied }) {
  const [resumes, setResumes] = useState(null)
  const [resumeId, setResumeId] = useState('')
  const [coverNote, setCoverNote] = useState('')
  const [consentResume, setConsentResume] = useState(false)
  const [consentAssessment, setConsentAssessment] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    resumeApi.list()
      .then((list) => { if (!cancelled) { setResumes(list); if (list[0]) setResumeId(String(list[0].id)) } })
      .catch((err) => { if (!cancelled) { setError(apiErrorMessage(err, 'Could not load your resumes.')); setResumes([]) } })
    return () => { cancelled = true }
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!resumeId) return setError('Choose a resume to apply with.')
    if (!consentResume) return setError('To apply you must agree to share your resume and profile with the hiring team.')
    setSubmitting(true)
    try {
      const application = await applicationApi.apply({ jobId: Number(jobId), resumeId: Number(resumeId), coverNote: coverNote.trim() || null, consentShareResume: true, consentShareAssessment: consentAssessment })
      onApplied(application)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit your application.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (resumes === null) return null
  if (resumes.length === 0) {
    return (
      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Apply for this job</h3>
        <p>You need a resume to apply. <Link to="/resumes">Upload one first →</Link></p>
        {error && <div className="field-error">{error}</div>}
      </Card>
    )
  }
  return (
    <Card style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Apply for this job</h3>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="resumeId">Resume to share with the hiring team</label>
          <select id="resumeId" className="select" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            {resumes.map((r) => <option key={r.id} value={r.id}>{r.original_filename}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="coverNote">Cover note (optional)</label>
          <textarea id="coverNote" className="input" rows={4} maxLength={2000} value={coverNote} onChange={(e) => setCoverNote(e.target.value)} />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '8px 0' }}>
          <input type="checkbox" checked={consentResume} onChange={(e) => setConsentResume(e.target.checked)} style={{ marginTop: 4 }} />
          <span>{CONSENT_RESUME_TEXT} <strong>(required)</strong></span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '8px 0' }}>
          <input type="checkbox" checked={consentAssessment} onChange={(e) => setConsentAssessment(e.target.checked)} style={{ marginTop: 4 }} />
          <span>{CONSENT_ASSESSMENT_TEXT} <em>(optional now — you can agree later from your application page)</em></span>
        </label>
        <ConsentNotice />
        {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
        <Button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit application'}</Button>
      </form>
    </Card>
  )
}
