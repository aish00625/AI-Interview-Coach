import { useEffect, useState } from 'react'
import Card from './Card.jsx'
import { jobApi, resumeApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'

const STATUS_STYLE = {
  matched: { color: 'var(--success)', label: 'Matched' },
  missing: { color: 'var(--danger)', label: 'Not on your profile' },
}

/** Private, explainable skills check for the signed-in candidate. Advisory only: nothing here is stored or sent to the hiring team. */
export default function JobFitPanel({ jobId }) {
  const [resumes, setResumes] = useState([])
  const [resumeId, setResumeId] = useState('')
  const [fit, setFit] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { resumeApi.list().then(setResumes).catch(() => setResumes([])) }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    jobApi.getFit(jobId, resumeId || null)
      .then((f) => !cancelled && setFit(f))
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not load your skills check.')))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [jobId, resumeId])

  return (
    <Card style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>How your skills line up</h3>
      <p style={{ color: 'var(--text-500)', fontSize: '0.85rem', marginTop: 0 }}>
        A private check for you only. The hiring team does not see it, and it does not decide anything about your application.
      </p>
      {resumes.length > 0 && (
        <label style={{ display: 'block', marginBottom: 10, fontSize: '0.85rem' }}>
          Also look in a resume:{' '}
          <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">Profile skills only</option>
            {resumes.map((r) => <option key={r.id} value={r.id}>{r.original_filename}</option>)}
          </select>
        </label>
      )}
      {loading && <p style={{ margin: 0 }}>Checking...</p>}
      {error && <div className="field-error">{error}</div>}
      {fit && !loading && (
        <>
          <p style={{ margin: '0 0 8px' }}>
            <strong>{fit.summary.matched} of {fit.summary.requiredTotal}</strong> required skills matched
            {fit.summary.mandatoryTotal > 0 && <> ({fit.summary.mandatoryMatched} of {fit.summary.mandatoryTotal} mandatory)</>}.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
            {fit.skills.map((s) => (
              <li key={s.name} style={{ marginBottom: 4 }}>
                <span className="badge" style={{ color: STATUS_STYLE[s.status].color, borderColor: STATUS_STYLE[s.status].color }}>{STATUS_STYLE[s.status].label}</span>{' '}
                <strong>{s.name}</strong>{s.mandatory ? '' : ' (optional)'} <span style={{ color: 'var(--text-500)', fontSize: '0.82rem' }}>— {s.evidence}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: '0 0 8px', color: fit.experience.status === 'mismatch' ? 'var(--danger)' : 'var(--text-300)' }}>{fit.experience.message}</p>
          {fit.nextSteps.length > 0 && (
            <>
              <h4 style={{ margin: '8px 0 4px' }}>Suggested next steps</h4>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{fit.nextSteps.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}</ul>
            </>
          )}
          {fit.resume && !fit.resume.textAvailable && <p style={{ color: 'var(--text-500)', fontSize: '0.82rem' }}>No text could be read from that resume, so only your profile skills were used.</p>}
          <p style={{ margin: '10px 0 0', color: 'var(--text-500)', fontSize: '0.78rem' }}>{fit.disclaimer}</p>
        </>
      )}
    </Card>
  )
}
