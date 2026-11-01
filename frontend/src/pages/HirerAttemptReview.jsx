import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import Select from '../components/Select.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import CodeEditor from '../components/CodeEditor.jsx'
import { hirerAssessmentApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useToast } from '../context/FeedbackContext.jsx'
import { eventTitle, formatClock, formatDuration } from '../utils/faceMonitor.js'
import { CATEGORY_LABELS, EVENT_CATEGORY_LABELS, MONITORING_CHOICE_LABELS, QUALITY_ISSUE_LABELS, formatRemaining, monitoringAnalysis } from '../utils/assessmentView.js'

const TABS = [['overview', 'Overview'], ['aptitude', 'Aptitude'], ['technical', 'Technical MCQs'], ['coding', 'Coding'], ['monitoring', 'Monitoring events'], ['notes', 'Reviewer notes']]
const LANG = { python: 'python', javascript: 'javascript', java: 'java', cpp: 'cpp' }

function McqList({ items }) {
  if (!items.length) return <p className="muted">This assessment has no questions in this section.</p>
  return (
    <ol>
      {items.map((q) => (
        <li key={q.itemId} style={{ marginBottom: 14 }}>
          <div>{q.questionText} <span className="small muted">({CATEGORY_LABELS[q.category] || q.category}, {q.difficulty}, {q.marks} mark(s))</span></div>
          <ol type="A" className="small" style={{ margin: '4px 0' }}>
            {q.choices.map((c) => {
              const chosen = q.selectedKeys.includes(c.key)
              const right = (q.correctKeys || []).includes(c.key)
              return <li key={c.key} style={{ fontWeight: right ? 600 : 400 }}>{c.text}{chosen ? ' - selected' : ''}{right ? ' (correct)' : ''}</li>
            })}
          </ol>
          <div className="small">
            {q.selectedKeys.length === 0 ? <Badge tone="muted">not answered</Badge> : q.isCorrect ? <Badge tone="success">correct</Badge> : q.isCorrect === false ? <Badge tone="danger">incorrect</Badge> : null}
            {q.awarded != null && <span> {q.awarded} mark(s)</span>}
          </div>
          {q.explanation && <p className="small muted" style={{ margin: '4px 0 0' }}>Explanation: {q.explanation}</p>}
        </li>
      ))}
    </ol>
  )
}

const TH = { textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-400)' }
const TD = { padding: '8px 10px', verticalAlign: 'top' }
const FEATURE_LABELS = { faceDetection: 'Face detection', multipleFaces: 'Multiple faces', imageQuality: 'Image quality', headPose: 'Head pose', gaze: 'Gaze', identity: 'Same-person check' }
const dur = (ms) => (ms ? formatDuration(ms) : '0 s')

function Stat({ label, value, hint }) {
  return (
    <div style={{ border: '1px solid var(--border-400)', borderRadius: 8, padding: '10px 12px' }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  )
}

function Measured({ title, m, what }) {
  return (
    <div style={{ border: '1px solid var(--border-400)', borderRadius: 8, padding: 12 }}>
      <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
      {!m.available
        ? <p className="small" style={{ margin: 0 }}><Badge tone="muted">Unavailable</Badge> {m.reason}</p>
        : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Measured for {dur(m.measuredMs)} ({m.frames} frame{m.frames === 1 ? '' : 's'} with a reliable estimate)</li>
            <li>{what}: {dur(m.deviationMs)} ({m.sharePct ?? 0}% of measured time)</li>
            <li>Recorded observations: {m.events}</li>
            {m.lowConfidenceFrames != null && <li>Low-confidence frames left out: {m.lowConfidenceFrames}</li>}
          </ul>
        )}
    </div>
  )
}

/** Camera monitoring results: stored counters and events only, with their limitations. Never a score, never a decision. */
function MonitoringTab({ monitoring }) {
  const a = monitoringAnalysis(monitoring)
  const identityNote = a.identity.state === 'available' ? 'Not used for assessments.' : 'Not configured on this server.'
  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <p style={{ marginTop: 0 }}><strong>{MONITORING_CHOICE_LABELS[monitoring.choice]}</strong>. {monitoring.summary}</p>
        {monitoring.accommodationNote && <p className="small">Candidate&apos;s note: {monitoring.accommodationNote}</p>}
        {monitoring.issues.length > 0 && (
          <p className="small" style={{ marginBottom: 0 }}>Technical issues reported by the candidate&apos;s browser: {monitoring.issues.map((i) => `${i.issue.replace(/_/g, ' ')} at ${formatClock(i.at)}`).join('; ')}</p>
        )}
      </Card>

      {a.hasData && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Camera analysis summary</h3>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <Stat label="Frames analysed" value={a.frames.analysed} hint={`over ${dur(a.time.monitoredMs)} monitored`} />
              <Stat label="Usable frames" value={a.frames.usable} />
              <Stat label="Unusable frames" value={a.frames.unusable} hint="too dark, bright or blurry" />
              <Stat label="Face present" value={a.frames.facePresent} hint="frames" />
              <Stat label="No face" value={a.frames.noFace} hint={`frames; ${a.noFaceEvents} observation(s)`} />
              <Stat label="Multiple faces" value={a.multipleFaces.events} hint={`observation(s); ${dur(a.multipleFaces.totalMs)}${a.multipleFaces.maxFaces ? `, max ${a.multipleFaces.maxFaces} faces` : ''}`} />
              <Stat label="Technical issues" value={a.technicalIssues} hint={a.gaps.count ? `${a.gaps.count} gap(s) with no frames, ${dur(a.gaps.totalMs)}` : 'events'} />
            </div>
            {monitoring.sessions.map((s) => (
              <p key={s.id} className="small muted" style={{ marginBottom: 0 }}>
                Session {formatClock(s.startedAt)} to {s.endedAt ? formatClock(s.endedAt) : 'still running'}. Features:{' '}
                {Object.entries(s.features || {}).map(([k, v]) => `${FEATURE_LABELS[k] || k} ${v.state === 'available' ? 'measured' : 'unavailable'}`).join(', ')}.
              </p>
            ))}
          </Card>

          <Card style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Head pose and gaze</h3>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <Measured title="Head pose" m={a.head} what="Head turned or tilted past the configured angles" />
              <Measured title="Gaze (horizontal estimate)" m={a.gaze} what="Eyes estimated off-centre" />
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>These are webcam estimates of where the head points and roughly where the eyes look. Reading, thinking, looking at notes you were allowed, or a second screen all produce them. They are not an attention measure.</p>
          </Card>

          <Card style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Image quality</h3>
            <p className="small">{a.frames.unusable} unusable frame(s); {a.quality.events.length} period(s) of poor image quality totalling {dur(a.quality.totalMs)}. This time is not counted as absence.</p>
            {Object.keys(a.quality.issueCounts).length > 0 && (
              <p className="small">{Object.entries(a.quality.issueCounts).map(([k, n]) => `${QUALITY_ISSUE_LABELS[k] || k.replace(/_/g, ' ')}: ${n}`).join(' - ')}</p>
            )}
            {a.quality.events.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                  <thead><tr><th style={TH}>Time</th><th style={TH}>Problem</th><th style={TH}>Duration</th></tr></thead>
                  <tbody>
                    {a.quality.events.map((q) => (
                      <tr key={q.id} style={{ borderTop: '1px solid var(--border-400)' }}>
                        <td style={TD} className="small">{formatClock(q.startedAt)}</td>
                        <td style={TD}>{q.issues.length ? q.issues.map((i) => QUALITY_ISSUE_LABELS[i] || i.replace(/_/g, ' ')).join(', ') : 'Frame could not be analysed'}</td>
                        <td style={TD} className="small">{q.durationMs != null ? formatDuration(q.durationMs) : (q.ongoing ? 'ongoing' : 'not recorded')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Card style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Events</h3>
        {monitoring.events.length === 0
          ? <p className="muted" style={{ marginBottom: 0 }}>No events recorded{monitoring.available ? '.' : ' (no monitoring data available - treat as unavailable, not as a concern).'}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr><th style={TH}>Time</th><th style={TH}>Observation</th><th style={TH}>Kind</th><th style={TH}>Duration</th><th style={{ ...TH, whiteSpace: 'normal' }}>Details</th></tr>
                </thead>
                <tbody>
                  {monitoring.events.map((e) => (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--border-400)' }}>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }} className="small">{formatClock(e.startedAt)}</td>
                      <td style={TD}>{eventTitle(e.type)}</td>
                      <td style={TD}><Badge tone={e.category === 'technical_issue' ? 'muted' : 'neutral'}>{EVENT_CATEGORY_LABELS[e.category] || e.category}</Badge></td>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }} className="small">{e.durationMs != null ? formatDuration(e.durationMs) : (e.status === 'ongoing' ? 'ongoing' : '-')}</td>
                      <td style={TD} className="small">{e.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>AI analysis limitations</h3>
        <ul className="small" style={{ marginBottom: 0 }}>
          <li>Head pose and gaze are estimates from an ordinary webcam. Glasses, lighting, camera angle and head position all affect them.</li>
          <li>Camera observations are not proof of misconduct. Looking away, a passer-by or a dark room have many innocent explanations.</li>
          <li>Same-person (identity) analysis: {identityNote} Nothing here verifies who the candidate is.</li>
          <li>Technical issues (camera, network or service problems, unusable frames) are never held against the candidate.</li>
          <li>Monitoring is not part of any score and never rejects anyone automatically. No video or images were stored.</li>
          {monitoring.limitations.filter((l) => !/not part of any score/i.test(l)).map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Card>
    </>
  )
}

/** One candidate's result. Monitoring is a separate tab with its limitations; it never appears in the overview's scores. */
export default function HirerAttemptReview() {
  const { attemptId } = useParams()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('overview')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await hirerAssessmentApi.attempt(attemptId)) } catch (err) { setError(apiErrorMessage(err, 'Could not load this result.')) }
  }, [attemptId])
  useEffect(() => { load() }, [load])

  async function addNote(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { const notes = await hirerAssessmentApi.addNote(attemptId, note.trim()); setData((d) => ({ ...d, notes })); setNote('') } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }
  async function setStatus(reviewStatus) {
    setBusy(true); setError('')
    try { await hirerAssessmentApi.setReviewStatus(attemptId, reviewStatus); setData((d) => ({ ...d, overview: { ...d.overview, reviewStatus } })); toast.success('Review status saved.') } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  if (!data) return error ? <div className="field-error">{error}</div> : <LoadingSpinner label="Loading result..." />
  const o = data.overview
  const name = o.identityHidden ? `Applicant #${o.applicationId} (blind review)` : o.candidateName
  return (
    <div>
      <PageHeader title={`${name} - ${o.assessmentTitle}`} description={`${o.jobTitle} - version ${o.assessmentVersion} - attempt ${o.attemptNo}`}
        actions={<div style={{ display: 'flex', gap: 8 }}><Link className="btn btn-secondary" to={`/hirer/assessments/${o.assessmentId}/candidates`}>All results</Link><Link className="btn btn-secondary" to={`/hirer/applications/${o.applicationId}`}>Application</Link></div>} />
      {error && <div className="field-error" style={{ marginBottom: 12 }} role="alert">{error}</div>}
      {data.restricted ? (
        <Card><p style={{ margin: 0 }}>The candidate withdrew this application, so their answers, code and monitoring data are no longer shown.</p></Card>
      ) : (
        <>
          <div role="tablist" aria-label="Result sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'overview' && (
            <Card>
              <p style={{ marginTop: 0 }}>Status: <Badge>{o.status.replace('_', ' ')}</Badge> {o.status === 'expired' && <span className="small muted">(time ran out; saved answers were scored)</span>}</p>
              <table style={{ borderCollapse: 'collapse', minWidth: 280 }}>
                <tbody>
                  {['aptitude', 'technical', 'coding'].filter((k) => o.sectionScores?.[k]).map((k) => (
                    <tr key={k}><td style={{ padding: '4px 12px 4px 0' }}>{k === 'technical' ? 'Technical MCQs' : k[0].toUpperCase() + k.slice(1)}</td><td>{o.sectionScores[k].score} / {o.sectionScores[k].max}</td></tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border-400)' }}><td style={{ padding: '4px 12px 4px 0' }}><strong>Total</strong></td><td><strong>{o.totalScore ?? '-'} / {o.maxScore ?? '-'}</strong></td></tr>
                </tbody>
              </table>
              {o.passPercent != null && o.meetsPassMark != null && <p className="small">Pass mark {o.passPercent}%: {o.meetsPassMark ? 'met' : 'not met'} (a label only; it changes nothing automatically).</p>}
              <p className="small muted">Started {new Date(o.startedAt).toLocaleString()}{o.submittedAt ? ` - finished ${new Date(o.submittedAt).toLocaleString()} - time taken ${formatRemaining(o.timeTakenMs)}` : ''}</p>
              <div style={{ maxWidth: 260 }}>
                <Select label="Review status" value={o.reviewStatus} disabled={busy} onChange={(e) => setStatus(e.target.value)}
                  options={[{ value: 'pending', label: 'Pending' }, { value: 'in_review', label: 'In review' }, { value: 'reviewed', label: 'Reviewed' }]} />
              </div>
              <p className="small muted">The hiring decision is made on the application page by your team.</p>
            </Card>
          )}
          {tab === 'aptitude' && <Card><McqList items={data.sections.aptitude} /></Card>}
          {tab === 'technical' && <Card><McqList items={data.sections.technical} /></Card>}
          {tab === 'coding' && (
            <Card>
              {!data.sections.coding.length && <p className="muted">No coding section.</p>}
              {data.sections.coding.map((c) => (
                <div key={c.itemId} style={{ marginBottom: 18 }}>
                  <h4 style={{ marginBottom: 4 }}>{c.title} <span className="small muted">({c.marks} marks)</span></h4>
                  <p className="small">{c.best ? `Best run: ${c.best.testsPassed}/${c.best.testsTotal} tests passed (${c.best.language})` : 'No submission.'} - {c.submissions.length} submission(s)</p>
                  {c.submissions.map((s, i) => (
                    <details key={s.id} open={i === c.submissions.length - 1}>
                      <summary className="small">#{i + 1} {s.language} - {s.status} {s.testsTotal ? `(${s.testsPassed}/${s.testsTotal})` : ''} - {new Date(s.submittedAt).toLocaleTimeString()}</summary>
                      <div style={{ height: 240, border: '1px solid var(--border-500)', borderRadius: 6, overflow: 'hidden', margin: '6px 0' }}>
                        <CodeEditor language={LANG[s.language]} value={s.sourceCode} readOnly fontSize={13} />
                      </div>
                    </details>
                  ))}
                </div>
              ))}
            </Card>
          )}
          {tab === 'monitoring' && <MonitoringTab monitoring={data.monitoring} />}
          {tab === 'notes' && (
            <Card>
              {data.notes.length === 0 && <p className="muted">No notes yet.</p>}
              {data.notes.map((n) => <p key={n.id} style={{ borderTop: '1px solid var(--border-400)', paddingTop: 6 }}><strong>{n.authorName}</strong> <span className="small muted">{new Date(n.createdAt).toLocaleString()}</span><br />{n.body}</p>)}
              <form onSubmit={addNote}>
                <label className="field-label" htmlFor="note">Add a note</label>
                <textarea id="note" className="input" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
                <Button type="submit" disabled={busy || !note.trim()} style={{ marginTop: 6 }}>Add note</Button>
              </form>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
