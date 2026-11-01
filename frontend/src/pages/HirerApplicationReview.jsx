import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import AdvisoryNote from '../components/AdvisoryNote.jsx'
import ScorecardPanel from '../components/ScorecardPanel.jsx'
import RejectDialog from '../components/RejectDialog.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerApplicationApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { saveBlob, formatBytes } from '../utils/download.js'
import { statusLabel, HIRER_ACTIONS } from '../utils/applicationLabels.js'

export default function HirerApplicationReview() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [showCode, setShowCode] = useState({})
  const [rejecting, setRejecting] = useState(false)

  const load = useCallback(async () => {
    try { setData(await hirerApplicationApi.get(id)) } catch (err) { setError(apiErrorMessage(err, 'Application not found.')) }
  }, [id])
  useEffect(() => { load() }, [load])

  async function move(status, reasonCode, rejectNote) {
    setBusy(true); setError('')
    try {
      setData(await hirerApplicationApi.setStatus(id, status, rejectNote || statusNote, reasonCode))
      setStatusNote(''); setRejecting(false)
    } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }
  async function addNote(e) {
    e.preventDefault()
    if (!note.trim()) return
    setBusy(true); setError('')
    try {
      const notes = await hirerApplicationApi.addNote(id, note.trim())
      setData((d) => ({ ...d, notes }))
      setNote('')
    } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }
  async function download() {
    setError('')
    try { saveBlob(await hirerApplicationApi.downloadResume(id), data.resume.filename) } catch (err) { setError(apiErrorMessage(err, 'Download failed.')) }
  }

  if (!data) return error ? <div><Link to="/hirer/dashboard">← Dashboard</Link><div className="field-error" style={{ marginTop: 12 }}>{error}</div></div> : <LoadingSpinner label="Loading..." />
  const app = data.application
  const back = <Link to={`/hirer/jobs/${app.jobId}/applicants`}>← Applicants for {app.jobTitle}</Link>

  const history = (
    <Card style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>History</h3>
      <ul>
        {data.history.map((h) => (
          <li key={h.id}>
            {new Date(h.created_at).toLocaleString()} — {h.from_status ? `${statusLabel(h.from_status)} → ` : ''}{statusLabel(h.to_status)} ({h.actor === 'candidate' ? 'candidate' : 'hiring team'}){h.reason ? ` — reason: ${h.reason}` : ''}{h.note ? ` — ${h.note}` : ''}
          </li>
        ))}
      </ul>
    </Card>
  )

  if (data.restricted) {
    return (
      <div>
        {back}
        <h1>Application withdrawn</h1>
        <Card><p style={{ margin: 0 }}>The candidate withdrew this application, so their profile, resume and assessment details are no longer available to you.</p></Card>
        {history}
      </div>
    )
  }

  const c = data.candidate
  return (
    <div>
      {back}
      <h1>{c.name || `Applicant #${app.id}`}</h1>
      {app.identityHidden && (
        <p role="note" style={{ border: '1px solid var(--border-400)', borderRadius: 6, padding: '8px 12px' }}>
          <strong>Blind review.</strong> Name, e-mail, resume and cover note are hidden until this application is shortlisted. Judge the skills, assessments and your scorecard.
        </p>
      )}
      <div style={{ color: 'var(--text-500)', marginBottom: 12 }}>
        {c.email ? `${c.email} · ` : ''}{c.experienceLevel}{c.targetRole ? ` · target role: ${c.targetRole}` : ''} · applied {new Date(app.appliedAt).toLocaleDateString()}
      </div>
      {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}

      <Card>
        <p style={{ marginTop: 0 }}>Status: <span className="badge">{statusLabel(app.status)}</span></p>
        {data.permissions && !data.permissions.decide && (
          <p style={{ color: 'var(--text-500)', fontSize: 13 }}>Your role (reviewer) can read, add notes and write scorecards. Changing the status needs a recruiter or owner.</p>
        )}
        {data.allowedTransitions.length > 0 && (
          <>
            <input className="input" placeholder="Optional note for the history" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} maxLength={1000} style={{ marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {data.allowedTransitions.map((s) => (
                <Button key={s} variant={s === 'rejected' ? 'danger' : s === 'under_review' ? 'secondary' : 'primary'} disabled={busy} onClick={() => (s === 'rejected' ? setRejecting(true) : move(s))}>
                  {HIRER_ACTIONS[s]}
                </Button>
              ))}
            </div>
          </>
        )}
        {app.coverNote && <p style={{ whiteSpace: 'pre-wrap' }}><strong>Cover note:</strong> {app.coverNote}</p>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Skills</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {c.requiredSkills.map((s) => (
            <span key={s.id} className="badge" style={{ borderColor: s.matched ? 'var(--accent-amber)' : undefined }}>{s.matched ? '✓' : '✗'} {s.name}</span>
          ))}
        </div>
        <div style={{ color: 'var(--text-500)' }}>Candidate lists: {c.skills.length ? c.skills.map((s) => s.name).join(', ') : 'no skills on profile'}</div>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Resume</h3>
          {data.resume && <Button variant="secondary" onClick={download}>Download {data.resume.filename} ({formatBytes(data.resume.sizeBytes)})</Button>}
        </div>
        {!data.resume && data.withheld?.resume === 'identity_hidden' && <p style={{ color: 'var(--text-500)' }}>Hidden by blind review until the candidate is shortlisted.</p>}
        {!data.resume && data.withheld?.resume === 'no_consent' && <p style={{ color: 'var(--text-500)' }}>The candidate has not agreed to share their resume with your organization yet.</p>}
        {data.resume && (data.resume.extractionStatus === 'ok' ? (
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', marginTop: 12 }}>{data.resume.text}</pre>
        ) : (
          <p style={{ color: 'var(--text-500)' }}>A text preview isn&apos;t available for this file — download the original to read it.</p>
        ))}
        {data.resume && <p style={{ color: 'var(--text-500)', fontSize: 12, marginBottom: 0 }}>Opening a resume is recorded in the access log.</p>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>AI interview assessment</h3>
        <AdvisoryNote />
        {data.withheld?.assessment === 'no_consent' ? <p style={{ margin: 0, color: 'var(--text-500)' }}>The candidate has not agreed to share assessment results with your organization yet.</p> : !data.interview ? <p style={{ margin: 0, color: 'var(--text-500)' }}>Not started or not part of this job&apos;s assessment.</p> : (
          <>
            <p>Status: <span className="badge">{data.interview.status.replace('_', ' ')}</span>{data.interview.finalScore != null && <> · Overall {data.interview.finalScore}/100 <em>(indicative AI score)</em></>}</p>
            {data.interview.questions.map((q) => (
              <div key={q.orderIndex} style={{ borderTop: '1px solid var(--border-400)', paddingTop: 8, marginTop: 8 }}>
                <strong>Q{q.orderIndex}. {q.question}</strong>
                <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{q.quality && q.quality.skipped ? <em>Skipped by the candidate (counts as 0)</em> : q.answered ? q.answer : <em>Not answered</em>}</p>
                {q.quality && (
                  <div style={{ fontSize: 13, margin: '2px 0' }}>
                    <span className="badge" title="How the automated check read this answer">{q.quality.label}</span>
                    {q.quality.attempts > 1 && <span style={{ marginLeft: 8, color: 'var(--text-500)' }}>Answered {q.quality.attempts} times; the latest attempt is shown.</span>}
                    {q.quality.lowConfidence && <span style={{ marginLeft: 8, color: 'var(--accent-amber)' }}>Low confidence: treat these scores as rough.</span>}
                  </div>
                )}
                {q.scores && q.quality && !q.quality.evaluable && !q.quality.skipped && (
                  <div style={{ color: 'var(--text-500)', fontSize: 13 }}>Not scored: the answer did not contain enough understandable content to evaluate (the zeros mean “not scored”, not “wrong”).</div>
                )}
                {q.scores && !(q.quality && !q.quality.evaluable) && (
                  <div style={{ color: 'var(--text-500)', fontSize: 13 }}>
                    Technical {q.scores.technical} · Relevance {q.scores.relevance} · Clarity {q.scores.clarity} · Completeness {q.scores.completeness}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Coding assessment</h3>
        {data.coding.length === 0 ? <p style={{ margin: 0, color: 'var(--text-500)' }}>No coding problems are part of this job&apos;s assessment.</p> : data.coding.map((p) => (
          <div key={p.problemId} style={{ borderTop: '1px solid var(--border-400)', paddingTop: 8, marginTop: 8 }}>
            <strong>{p.title}</strong> <span className={`badge badge-${p.difficulty}`}>{p.difficulty}</span>
            {!p.best ? <div style={{ color: 'var(--text-500)' }}>Not attempted</div> : (
              <>
                <div>Best: <span className="badge">{p.best.status}</span> {p.best.testsPassed}/{p.best.testsTotal} tests · {p.best.language} · {p.attemptCount} attempt{p.attemptCount > 1 ? 's' : ''}</div>
                <button type="button" className="btn btn-secondary" style={{ marginTop: 6 }} onClick={() => setShowCode((s) => ({ ...s, [p.problemId]: !s[p.problemId] }))}>
                  {showCode[p.problemId] ? 'Hide code' : 'View best submission'}
                </button>
                {showCode[p.problemId] && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{p.best.sourceCode}</pre>}
              </>
            )}
          </div>
        ))}
      </Card>

      <ScorecardPanel applicationId={app.id} scorecards={data.scorecards} canReview={Boolean(data.permissions?.review)} onChange={(scorecards) => setData((d) => ({ ...d, scorecards }))} />

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Internal notes <span style={{ color: 'var(--text-500)', fontSize: 13 }}>(never visible to the candidate)</span></h3>
        {data.notes.map((n) => (
          <div key={n.id} style={{ borderTop: '1px solid var(--border-400)', padding: '8px 0' }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
            <div style={{ color: 'var(--text-500)', fontSize: 12 }}>{n.author_name || 'Team member'} · {new Date(n.created_at).toLocaleString()}</div>
          </div>
        ))}
        <form onSubmit={addNote} style={{ marginTop: 8 }}>
          <textarea className="input" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for your team" />
          <Button type="submit" disabled={busy || !note.trim()} style={{ marginTop: 8 }}>Add note</Button>
        </form>
      </Card>
      {history}
      <RejectDialog open={rejecting} reasons={data.rejectionReasons || {}} busy={busy} onCancel={() => setRejecting(false)} onConfirm={(code, rejectNote) => move('rejected', code, rejectNote)} />
    </div>
  )
}
