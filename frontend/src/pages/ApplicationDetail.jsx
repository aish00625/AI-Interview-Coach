import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { applicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { statusLabel } from '../utils/applicationLabels.js'
import ConsentNotice, { CONSENT_RESUME_TEXT, CONSENT_ASSESSMENT_TEXT } from '../components/ConsentNotice.jsx'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'

const WITHDRAWABLE = ['submitted', 'under_review', 'shortlisted']

export default function ApplicationDetail() {
  const confirm = useConfirm()
  const toast = useToast()
  const { id } = useParams()
  const [app, setApp] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [answerMode, setAnswerMode] = useState('text')
  const [accessLog, setAccessLog] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try { setApp(await applicationApi.get(id)) } catch (err) { setError(apiErrorMessage(err, 'Application not found.')) }
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    let cancelled = false
    applicationApi.accessLog(id).then((e) => !cancelled && setAccessLog(e)).catch(() => !cancelled && setAccessLog([]))
    return () => { cancelled = true }
  }, [id, app?.status])

  async function grant(what) {
    setBusy(true); setError('')
    try { setApp(await applicationApi.grantConsent(id, { [what]: true })) } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  async function withdraw() {
    if (!(await confirm({ title: 'Withdraw this application?', message: 'The hiring team will no longer see it as active. You can apply again later if the job is still open.', confirmLabel: 'Withdraw application', tone: 'danger' }))) return
    setBusy(true); setError('')
    try { setApp(await applicationApi.withdraw(id)); toast.success('Application withdrawn.') } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  async function startInterview() {
    setBusy(true); setError('')
    try {
      const { session } = await applicationApi.startInterviewAssessment(id)
      navigate(`/interview/${session.id}`, { state: { setup: { answerMode } } })
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not start the interview.'))
      setBusy(false)
    }
  }

  if (error && !app) return <div><Link to="/applications">← My applications</Link><div className="field-error" style={{ marginTop: 12 }}>{error}</div></div>
  if (!app) return <LoadingSpinner label="Loading..." />

  return (
    <div>
      <Link to="/applications">← My applications</Link>
      <h1>{app.job_title}</h1>
      <div style={{ color: 'var(--text-500)', marginBottom: 12 }}>{app.organization_name}{app.job_location ? ` · ${app.job_location}` : ''}</div>
      <Card>
        <p>Status: <span className="badge">{statusLabel(app.status)}</span></p>
        <p>Resume shared: {app.resume_filename}</p>
        {app.cover_note && <p style={{ whiteSpace: 'pre-wrap' }}>Cover note: {app.cover_note}</p>}
        <h3>History</h3>
        <ul>
          {app.history.map((h, i) => (
            <li key={i}>
              {new Date(h.created_at).toLocaleString()} — {h.from_status ? `${statusLabel(h.from_status)} → ` : ''}{statusLabel(h.to_status)}
              {h.reason && <div style={{ color: 'var(--text-500)', fontSize: 13 }}>Reason: {h.reason}</div>}
            </li>
          ))}
        </ul>
        {app.job_blind_review && <p style={{ color: 'var(--text-500)', fontSize: 13 }}>This employer screens applications anonymously: your name, e-mail and resume are hidden from reviewers until you are shortlisted.</p>}

        {WITHDRAWABLE.includes(app.status) && (
          <div style={{ margin: '16px 0' }}>
            <h3>What you are sharing</h3>
            <p style={{ margin: '4px 0' }}>
              Profile and resume: {app.consent?.resume ? <span className="badge">Shared</span> : <span className="badge">Not shared yet</span>}
              {!app.consent?.resume && <Button variant="secondary" onClick={() => grant('resume')} disabled={busy} style={{ marginLeft: 8 }}>I agree</Button>}
            </p>
            {!app.consent?.resume && <p style={{ color: 'var(--text-500)', fontSize: 13 }}>{CONSENT_RESUME_TEXT}</p>}
            <p style={{ margin: '4px 0' }}>
              Assessment results: {app.consent?.assessment ? <span className="badge">Shared</span> : <span className="badge">Not shared yet</span>}
              {!app.consent?.assessment && <Button variant="secondary" onClick={() => grant('assessment')} disabled={busy} style={{ marginLeft: 8 }}>I agree</Button>}
            </p>
            {!app.consent?.assessment && <p style={{ color: 'var(--text-500)', fontSize: 13 }}>{CONSENT_ASSESSMENT_TEXT}</p>}
            <ConsentNotice />
          </div>
        )}
        {app.assessment?.configured && (
          <div style={{ margin: '16px 0' }}>
            <h3>Assessments</h3>
            {WITHDRAWABLE.includes(app.status) ? (
              <p style={{ color: 'var(--text-500)' }}>Results are shared with the hiring team. These are separate from your private practice sessions.</p>
            ) : (
              <p style={{ color: 'var(--text-500)' }}>Assessments are only available while your application is active.</p>
            )}
            {app.assessment.interview && (
              <Card style={{ marginBottom: 12 }}>
                <strong>AI interview</strong> ({app.assessment.interview.interviewType}, {app.assessment.interview.difficulty})
                <div style={{ margin: '8px 0' }}>
                  Status: <span className="badge">{app.assessment.interview.status.replace('_', ' ')}</span>
                  {app.assessment.interview.finalScore != null && <> · Score {app.assessment.interview.finalScore}/100 (indicative)</>}
                </div>
                {WITHDRAWABLE.includes(app.status) && app.consent?.assessment && app.assessment.interview.status === 'not_started' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select className="select" value={answerMode} onChange={(e) => setAnswerMode(e.target.value)} style={{ maxWidth: 180 }}>
                      <option value="text">Type answers</option>
                      <option value="voice">Voice answers</option>
                    </select>
                    <Button onClick={startInterview} disabled={busy}>Start interview</Button>
                  </div>
                )}
                {WITHDRAWABLE.includes(app.status) && app.consent?.assessment && app.assessment.interview.status === 'in_progress' && (
                  <Button onClick={startInterview} disabled={busy}>Continue interview</Button>
                )}
                {app.assessment.interview.status === 'completed' && (
                  <Link to={`/interview/${app.assessment.interview.sessionId}/results`}>View my results</Link>
                )}
              </Card>
            )}
            {app.assessment.coding.map((c) => (
              <Card key={c.problemId} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{c.title}</strong> <span className={`badge badge-${c.difficulty}`}>{c.difficulty}</span>
                    <div style={{ color: 'var(--text-500)' }}>
                      Attempts {c.attempts}/{c.maxAttempts} · best: {c.bestStatus.replace('_', ' ')}
                      {c.bestTotal ? ` (${c.bestPassed}/${c.bestTotal} tests)` : ''}
                    </div>
                  </div>
                  {WITHDRAWABLE.includes(app.status) && app.consent?.assessment && c.attempts < c.maxAttempts && (
                    <Link to={`/coding/${c.problemId}?application=${app.id}`}><Button variant="secondary">{c.attempts ? 'Try again' : 'Start'}</Button></Link>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
        <div style={{ margin: '16px 0' }}>
          <h3>Who has looked at my data</h3>
          {accessLog === null ? <p style={{ color: 'var(--text-500)' }}>Loading...</p> : accessLog.length === 0 ? (
            <p style={{ color: 'var(--text-500)' }}>Nobody at {app.organization_name} has opened your resume or assessment results yet.</p>
          ) : (
            <ul>{accessLog.map((e) => <li key={e.id}>{new Date(e.at).toLocaleString()} — {e.description}</li>)}</ul>
          )}
        </div>
        {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}
        {WITHDRAWABLE.includes(app.status) && <Button variant="danger" onClick={withdraw} disabled={busy}>Withdraw application</Button>}
      </Card>
    </div>
  )
}
