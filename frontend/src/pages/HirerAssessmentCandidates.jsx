import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerAssessmentApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useAuth } from '../hooks/useAuth.js'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'
import { SKIP_REASONS, formatRemaining } from '../utils/assessmentView.js'

const ACTIVE = ['submitted', 'under_review', 'shortlisted']
const STATUS_TONE = { in_progress: 'info', submitted: 'success', expired: 'warning' }
const who = (c) => (c.identityHidden ? `Applicant #${c.applicationId} (blind review)` : c.candidateName)

/** Invitations, live status and results for one assessment. Scores support the team's decision; they never make it. */
export default function HirerAssessmentCandidates() {
  const { id } = useParams()
  const { user } = useAuth()
  const canManage = ['owner', 'recruiter'].includes(user?.organization?.memberRole)
  const confirm = useConfirm()
  const toast = useToast()
  const [cands, setCands] = useState(null)
  const [results, setResults] = useState(null)
  const [selected, setSelected] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([hirerAssessmentApi.candidates(id), hirerAssessmentApi.attempts(id)])
      setCands(c); setResults(r)
    } catch (err) { setError(apiErrorMessage(err, 'Could not load candidates.')) }
  }, [id])
  useEffect(() => { load() }, [load])

  const eligible = (c) => ACTIVE.includes(c.applicationStatus) && c.consented && (!c.invitation || c.invitation.revoked)

  async function invite() {
    setBusy(true); setError('')
    try {
      const r = await hirerAssessmentApi.invite(id, selected)
      if (r.invited.length) toast.success(`Invited ${r.invited.length} applicant(s). They were notified in the app.`)
      if (r.skipped.length) setError(`Not invited: ${r.skipped.map((s) => `#${s.applicationId} ${SKIP_REASONS[s.reason] || s.reason}`).join('; ')}`)
      setSelected([]); await load()
    } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  async function revoke(c) {
    if (!(await confirm({ title: 'Withdraw this invitation?', message: 'The candidate can no longer start the assessment. Attempts already made are kept.', tone: 'danger' }))) return
    setBusy(true)
    try { await hirerAssessmentApi.revokeInvitation(id, c.invitation.id); await load() } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  if (!cands || !results) return error ? <div className="field-error">{error}</div> : <LoadingSpinner label="Loading candidates..." />
  const a = cands.assessment
  return (
    <div>
      <PageHeader title={`${a.title}: candidates & results`} description={`${a.jobTitle} - ${a.status}`} actions={<Link className="btn btn-secondary" to={`/hirer/assessments/${id}`}>Assessment</Link>} />
      {error && <div className="field-error" style={{ marginBottom: 12 }} role="alert">{error}</div>}

      <Card style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Applicants</h3>
        <p className="small muted">Only active applications whose candidate agreed to share assessment results can be invited. Invited candidates find it under My assessments.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left' }}><th></th><th>Candidate</th><th>Application</th><th>Consent</th><th>Invitation</th><th>Latest attempt</th><th></th></tr></thead>
            <tbody>
              {cands.candidates.map((c) => (
                <tr key={c.applicationId} style={{ borderTop: '1px solid var(--border-400)' }}>
                  <td>{canManage && a.status === 'published' && eligible(c) && (
                    <input type="checkbox" aria-label={`Select ${who(c)}`} checked={selected.includes(c.applicationId)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.applicationId] : s.filter((x) => x !== c.applicationId)))} />
                  )}</td>
                  <td style={{ padding: '8px 4px' }}><Link to={`/hirer/applications/${c.applicationId}`}>{who(c)}</Link></td>
                  <td>{c.applicationStatus.replace('_', ' ')}</td>
                  <td>{c.consented ? 'Shared' : <span className="muted">Not shared</span>}</td>
                  <td>{!c.invitation ? <span className="muted">Not invited</span> : c.invitation.revoked ? <Badge tone="muted">withdrawn</Badge> : <Badge tone="info">invited</Badge>}</td>
                  <td>{c.invitation?.latestStatus ? <Badge tone={STATUS_TONE[c.invitation.latestStatus]}>{c.invitation.latestStatus.replace('_', ' ')}</Badge> : '-'}</td>
                  <td>{canManage && c.invitation && !c.invitation.revoked && <Button variant="secondary" size="sm" onClick={() => revoke(c)} disabled={busy}>Withdraw</Button>}</td>
                </tr>
              ))}
              {!cands.candidates.length && <tr><td colSpan={7} className="muted" style={{ padding: 8 }}>No applications for this job yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {canManage && a.status === 'published' && <Button onClick={invite} disabled={busy || !selected.length} style={{ marginTop: 8 }}>Invite selected ({selected.length})</Button>}
        {canManage && a.status !== 'published' && <p className="small muted">{a.status === 'draft' ? 'Publish the assessment to invite applicants.' : 'This assessment is closed.'}</p>}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>Results</h3>
        <p className="small muted">
          Scores are calculated by the server from saved answers and code runs. Camera monitoring is shown separately on each result and is never part of a score.
          {results.assessment.passPercent != null && ` The ${results.assessment.passPercent}% pass mark is a label only; it does not change any application.`}
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left' }}><th>Candidate</th><th>Status</th><th>Aptitude</th><th>Technical</th><th>Coding</th><th>Total</th><th>Time</th><th>Submitted</th><th>Review</th><th></th></tr></thead>
            <tbody>
              {results.attempts.map((t) => {
                const s = (k) => (t.sectionScores?.[k] ? `${t.sectionScores[k].score}/${t.sectionScores[k].max}` : '-')
                return (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border-400)' }}>
                    <td style={{ padding: '8px 4px' }}>{who(t)}{t.attemptNo > 1 ? <span className="small muted"> (attempt {t.attemptNo})</span> : null}</td>
                    <td><Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge></td>
                    <td>{s('aptitude')}</td><td>{s('technical')}</td><td>{s('coding')}</td>
                    <td>{t.totalScore != null ? <strong>{t.totalScore}/{t.maxScore}</strong> : '-'}{t.meetsPassMark != null && <span className="small muted"> {t.meetsPassMark ? '(meets pass mark)' : '(below pass mark)'}</span>}</td>
                    <td>{t.timeTakenMs != null ? formatRemaining(t.timeTakenMs) : '-'}</td>
                    <td className="small">{t.submittedAt ? new Date(t.submittedAt).toLocaleString() : '-'}</td>
                    <td><Badge tone="muted">{t.reviewStatus.replace('_', ' ')}</Badge></td>
                    <td><Link to={`/hirer/assessment-attempts/${t.id}`}>Open</Link></td>
                  </tr>
                )
              })}
              {!results.attempts.length && <tr><td colSpan={10} className="muted" style={{ padding: 8 }}>No attempts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
