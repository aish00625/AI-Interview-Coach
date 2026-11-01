import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import Select from '../components/Select.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import CodeEditor from '../components/CodeEditor.jsx'
import { candidateAssessmentApi, codingApi, faceMonitorApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useConfirm } from '../context/FeedbackContext.jsx'
import { createFaceMonitorController, makeBrowserCapture, initialState } from '../utils/faceMonitorController.js'
import { classifyCameraError } from '../utils/faceMonitor.js'
import { SECTION_LABELS, answeredCounts, formatRemaining, remainingMs, monitoringStatus } from '../utils/assessmentView.js'

const LANGS = [{ value: 'python', label: 'Python' }, { value: 'javascript', label: 'JavaScript' }, { value: 'java', label: 'Java' }, { value: 'cpp', label: 'C++' }]
const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

function Confirmation({ data }) {
  const labels = { aptitude: 'Aptitude', technical: 'Technical MCQs', coding: 'Coding' }
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>{data.status === 'expired' ? 'Time is up - your saved answers were submitted' : 'Assessment submitted'}</h2>
      <p>Received {data.submittedAt ? new Date(data.submittedAt).toLocaleString() : ''}. The hiring team will review it; you will be notified about your application.</p>
      <ul>{Object.entries(data.sections || {}).map(([k, v]) => <li key={k}>{labels[k] || k}: {v.answered} of {v.total} answered</li>)}</ul>
      <Link className="btn btn-secondary" to="/assessments">Back to my assessments</Link>
    </Card>
  )
}

/** The whole candidate journey for one invitation: instructions, consent, device check, sections, review, confirmation. */
export default function TakeAssessment() {
  const { invitationId } = useParams()
  const confirm = useConfirm()
  const [inv, setInv] = useState(null)
  const [stage, setStage] = useState('loading') // loading | intro | device | attempt | review | done
  const [terms, setTerms] = useState(false)
  const [choice, setChoice] = useState('')
  const [note, setNote] = useState('')
  const [deviceMsg, setDeviceMsg] = useState('')
  const [deviceOk, setDeviceOk] = useState(false)
  const [state, setState] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const [now, setNow] = useState(Date.now())
  const [current, setCurrent] = useState(null)
  const [answers, setAnswers] = useState({})
  const [saving, setSaving] = useState({})
  const [code, setCode] = useState({})
  const [codeResult, setCodeResult] = useState({})
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(initialState())
  const [monitorMsg, setMonitorMsg] = useState('')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const previewRef = useRef(null)
  const previewStream = useRef(null)
  const controllerRef = useRef(null)
  const attemptIdRef = useRef(null)

  const stopPreview = () => { previewStream.current?.getTracks().forEach((t) => t.stop()); previewStream.current = null }

  // One monitoring controller for the page; it always releases the camera on unmount.
  useEffect(() => {
    const controller = createFaceMonitorController({
      api: { submitFrame: faceMonitorApi.submitFrame, reportCameraStatus: faceMonitorApi.reportCameraStatus },
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      captureFrame: () => makeBrowserCapture(videoRef.current, canvasRef.current)(),
      attachStream: (stream) => { const v = videoRef.current; if (v) { v.srcObject = stream || null; if (stream) v.play?.().catch(() => {}) } },
      onChange: setLive,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t),
      intervalMs: 2000,
      describeError: (e) => apiErrorMessage(e, 'A camera frame could not be processed.'),
    })
    controllerRef.current = controller
    return () => { controller.stop(); stopPreview() }
  }, [])

  const loadAttempt = useCallback(async (attemptId) => {
    const s = await candidateAssessmentApi.attempt(attemptId)
    setState(s); setFetchedAt(Date.now())
    if (s.attempt.status !== 'in_progress') {
      controllerRef.current?.stop()
      setDone(await candidateAssessmentApi.confirmation(attemptId)); setStage('done')
      return s
    }
    setAnswers(Object.fromEntries((s.answers || []).map((a) => [a.itemId, a.selectedKeys])))
    setCode((c) => ({ ...Object.fromEntries((s.code || []).map((x) => [x.itemId, { language: x.language, source: x.sourceCode }])), ...c }))
    setCurrent((cur) => cur ?? (s.sections.find((x) => x.entered && !x.locked) || s.sections[0])?.id)
    return s
  }, [])

  const startMonitoring = useCallback(async (attemptId) => {
    setMonitorMsg('')
    try {
      const res = await candidateAssessmentApi.startMonitoring(attemptId)
      await controllerRef.current.start(res.session.id, res.session)
      setMonitorMsg('')
    } catch (err) {
      setMonitorMsg(apiErrorMessage(err, 'Camera monitoring could not start.'))
    }
  }, [])

  // Initial load: an open attempt resumes directly; a finished one shows its confirmation.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await candidateAssessmentApi.invitation(invitationId)
        if (cancelled) return
        setInv(d)
        const i = d.invitation
        if (i.openAttemptId) {
          attemptIdRef.current = i.openAttemptId
          const s = await loadAttempt(i.openAttemptId)
          if (!cancelled && s.attempt.status === 'in_progress') {
            setStage('attempt')
            if (s.attempt.monitoringChoice === 'camera') startMonitoring(i.openAttemptId)
          }
        } else if (!i.canStart && i.latestAttemptId) {
          setDone(await candidateAssessmentApi.confirmation(i.latestAttemptId)); setStage('done')
        } else setStage('intro')
      } catch (err) { if (!cancelled) setError(apiErrorMessage(err, 'Could not load this assessment.')) }
    })()
    return () => { cancelled = true }
  }, [invitationId, loadAttempt, startMonitoring])

  // Clock tick for the countdown; when the server deadline passes, ask the server (it closes the attempt).
  useEffect(() => {
    if (stage !== 'attempt' && stage !== 'review') return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [stage])
  const left = state ? remainingMs(state.attempt.deadlineAt, state.serverNow, fetchedAt, now) : 0
  useEffect(() => {
    if ((stage === 'attempt' || stage === 'review') && state && left === 0) loadAttempt(attemptIdRef.current).catch(() => {})
  }, [left, stage, state, loadAttempt])

  // A camera problem during the attempt is recorded on the attempt as a TECHNICAL issue (once per kind per page load), so
  // reviewers see "monitoring unavailable" instead of silence. It is never treated as behaviour.
  const reportedRef = useRef(new Set())
  useEffect(() => {
    if (stage !== 'attempt' || state?.attempt?.monitoringChoice !== 'camera' || live.camera.state !== 'error') return
    const issue = live.camera.status === 'permission_denied' ? 'camera_denied' : live.camera.status === 'track_ended' ? 'camera_lost' : 'camera_unavailable'
    if (reportedRef.current.has(issue) || !attemptIdRef.current) return
    reportedRef.current.add(issue)
    candidateAssessmentApi.reportMonitoringIssue(attemptIdRef.current, issue).catch(() => {})
  }, [stage, state?.attempt?.monitoringChoice, live.camera.state, live.camera.status])

  const sections = state?.sections || []
  const section = sections.find((s) => s.id === current)
  const counts = useMemo(() => answeredCounts(sections, Object.entries(answers).map(([k, v]) => ({ itemId: Number(k), selectedKeys: v })), state?.codingRuns), [sections, answers, state])
  const sectionLeft = section && section.entered && section.durationMinutes ? remainingMs(section.deadlineAt, state.serverNow, fetchedAt, now) : null

  const handleError = async (err) => {
    const reason = err?.response?.data?.reason
    if (reason === 'expired' || reason === 'not_in_progress') { await loadAttempt(attemptIdRef.current).catch(() => {}); return }
    setError(apiErrorMessage(err))
  }

  async function checkCamera() {
    setDeviceMsg(''); setDeviceOk(false)
    if (!cameraSupported()) { setDeviceMsg('This browser cannot use a camera. Use a current Chrome, Edge or Firefox, or choose the alternative.'); return }
    try {
      stopPreview()
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false })
      previewStream.current = stream
      if (previewRef.current) { previewRef.current.srcObject = stream; previewRef.current.play?.().catch(() => {}) }
      setDeviceOk(true)
    } catch (err) {
      const c = classifyCameraError(err)
      setDeviceMsg(`${c.message} You can fix this and try again, or choose the alternative (no camera).`)
    }
  }

  async function begin() {
    setBusy(true); setError('')
    try {
      stopPreview()
      const r = await candidateAssessmentApi.start(invitationId, { acceptTerms: true, monitoring: inv.invitation.assessment.monitoringEnabled ? choice : undefined, accommodationNote: choice === 'alternative' ? note : undefined })
      attemptIdRef.current = r.attemptId
      const s = await loadAttempt(r.attemptId)
      if (s.attempt.status === 'in_progress') {
        setStage('attempt')
        if (s.attempt.monitoringChoice === 'camera') startMonitoring(r.attemptId)
      }
    } catch (err) { setError(apiErrorMessage(err, 'Could not start the assessment.')) } finally { setBusy(false) }
  }

  async function openSection(target) {
    const leaving = sections.find((s) => s.id === current)
    if (leaving && leaving.entered && !leaving.locked && !leaving.allowBack && leaving.id !== target.id) {
      if (!(await confirm({ title: `Leave ${SECTION_LABELS[leaving.kind]}?`, message: 'You cannot come back to this section once you leave it. Your saved answers are kept.', confirmLabel: 'Leave section' }))) return
    }
    setBusy(true); setError('')
    try {
      if (!target.entered || (leaving && !leaving.allowBack && leaving.id !== target.id)) {
        const s = await candidateAssessmentApi.enterSection(attemptIdRef.current, target.id)
        setState(s); setFetchedAt(Date.now())
      }
      setCurrent(target.id)
    } catch (err) { await handleError(err) } finally { setBusy(false) }
  }

  async function choose(item, key) {
    const prev = answers[item.id] || []
    const next = item.question.questionType === 'multiple' ? (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].sort()) : [key]
    setAnswers((a) => ({ ...a, [item.id]: next }))
    setSaving((s) => ({ ...s, [item.id]: 'saving' }))
    try {
      await candidateAssessmentApi.saveAnswer(attemptIdRef.current, item.id, next)
      setSaving((s) => ({ ...s, [item.id]: 'saved' }))
    } catch (err) {
      setAnswers((a) => ({ ...a, [item.id]: prev }))
      setSaving((s) => ({ ...s, [item.id]: 'error' }))
      await handleError(err)
    }
  }

  async function ensureStarter(item, language) {
    if (code[item.id]?.source) return
    try {
      const p = await codingApi.getCodingProblem(item.coding.problemId)
      setCode((c) => ({ ...c, [item.id]: { language, source: c[item.id]?.source || p.starterCode?.[language] || '' } }))
    } catch { setCode((c) => ({ ...c, [item.id]: { language, source: c[item.id]?.source || '' } })) }
  }

  async function runSamples(item) {
    const c = code[item.id]
    setBusy(true); setError('')
    try {
      const r = await codingApi.runCode({ problemId: item.coding.problemId, language: c.language, sourceCode: c.source })
      setCodeResult((x) => ({ ...x, [item.id]: { kind: 'samples', ...r } }))
    } catch (err) { setError(apiErrorMessage(err, 'Could not run the sample tests.')) } finally { setBusy(false) }
  }

  async function submitCode(item) {
    const c = code[item.id]
    setBusy(true); setError('')
    try {
      const r = await candidateAssessmentApi.submitCode(attemptIdRef.current, item.id, c.language, c.source)
      setCodeResult((x) => ({ ...x, [item.id]: { kind: 'submit', ...r } }))
      setState((s) => ({ ...s, codingRuns: [...(s.codingRuns || []), { itemId: item.id, status: r.status, testsPassed: r.passedTests, testsTotal: r.totalTests }] }))
    } catch (err) {
      if (err?.response?.status === 503) setError('The code runner is unavailable right now. This does not count against you - try again in a moment.')
      else await handleError(err)
    } finally { setBusy(false) }
  }

  async function finalSubmit() {
    const unanswered = sections.reduce((n, s) => n + (counts[s.id]?.unanswered || 0), 0)
    if (!(await confirm({ title: 'Submit your assessment?', message: unanswered ? `${unanswered} question(s) are unanswered. You cannot change anything after submitting.` : 'You cannot change anything after submitting.', confirmLabel: 'Submit' }))) return
    setBusy(true); setError('')
    try {
      const r = await candidateAssessmentApi.submit(attemptIdRef.current)
      controllerRef.current?.stop()
      setDone(r); setStage('done')
    } catch (err) { await handleError(err) } finally { setBusy(false) }
  }

  if (error && stage === 'loading') return <div className="field-error">{error}</div>
  if (stage === 'loading') return <LoadingSpinner label="Loading assessment..." />
  if (stage === 'done') return <Confirmation data={done} />
  const a = inv.invitation.assessment
  const notice = inv.monitoringNotice

  if (stage === 'intro' || stage === 'device') {
    const blocked = !inv.invitation.canStart
    return (
      <div>
        <h1>{a.title}</h1>
        <p className="muted">{inv.invitation.organizationName} - {inv.invitation.jobTitle} - {a.durationMinutes} minutes - attempt {inv.invitation.attemptsUsed + 1} of {a.maxAttempts}</p>
        {error && <div className="field-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        {blocked && <Card><p style={{ margin: 0 }}>{inv.invitation.blockedMessage}</p></Card>}
        {!blocked && stage === 'intro' && (
          <>
            <Card style={{ marginBottom: 12 }}>
              <h3 style={{ marginTop: 0 }}>Instructions</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{a.instructions}</p>
              <ul className="small">
                <li>The timer is kept by the server and keeps running if you close or refresh the page. You can resume where you left off.</li>
                <li>Your answers are saved as you go. When time runs out, what you saved is submitted automatically.</li>
                <li>Some sections may not let you go back once you leave them; you will be warned first.</li>
              </ul>
            </Card>
            {notice && (
              <Card style={{ marginBottom: 12 }}>
                <h3 style={{ marginTop: 0 }}>Camera monitoring (your choice)</h3>
                <p className="small">If you agree, your camera is analysed every few seconds while you work. What is measured:</p>
                <ul className="small">{notice.runs.filter((r) => !/same-person/i.test(r)).map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="small">Not stored: {notice.notStored.join(', ')}. Records are kept for {notice.retentionDays} days.</p>
                <ul className="small">{notice.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                <label style={{ display: 'block' }}><input type="radio" name="mon" checked={choice === 'camera'} onChange={() => setChoice('camera')} /> I agree to camera monitoring as described</label>
                <label style={{ display: 'block' }}><input type="radio" name="mon" checked={choice === 'alternative'} onChange={() => setChoice('alternative')} /> I cannot or prefer not to use a camera (alternative - no penalty)</label>
                {choice === 'alternative' && (
                  <textarea className="input" rows={2} maxLength={1000} placeholder="Optional: anything the hiring team should know (for example an accommodation you need)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
                )}
              </Card>
            )}
            <Card>
              <label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I have read the instructions and will complete this assessment myself.</label>
              <div style={{ marginTop: 12 }}>
                <Button disabled={!terms || (notice && !choice) || busy} onClick={() => (choice === 'camera' ? (setStage('device'), checkCamera()) : begin())}>
                  {choice === 'camera' ? 'Next: camera check' : busy ? 'Starting...' : 'Start assessment'}
                </Button>
              </div>
            </Card>
          </>
        )}
        {!blocked && stage === 'device' && (
          <Card>
            <h3 style={{ marginTop: 0 }}>Camera check</h3>
            <video ref={previewRef} muted playsInline style={{ width: 320, maxWidth: '100%', background: '#111', borderRadius: 8 }} aria-label="Camera preview" />
            {deviceMsg && <p className="field-error" role="alert">{deviceMsg}</p>}
            {deviceOk && <p className="small">Your camera works. Make sure your face is visible and well lit.</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <Button onClick={begin} disabled={!deviceOk || busy}>{busy ? 'Starting...' : 'Start assessment'}</Button>
              <Button variant="secondary" onClick={checkCamera} disabled={busy}>Try again</Button>
              <Button variant="secondary" onClick={() => { stopPreview(); setChoice('alternative'); setStage('intro') }} disabled={busy}>Use the alternative instead</Button>
            </div>
          </Card>
        )}
      </div>
    )
  }

  // attempt / review
  const mon = monitoringStatus(live, monitorMsg)
  const answeredTotal = sections.reduce((n, s) => n + (counts[s.id]?.answered || 0), 0)
  const itemTotal = sections.reduce((n, s) => n + (s.itemCount || 0), 0)
  return (
    <div>
      {/* Sticky bar: themed background (the page is dark) so its text and buttons stay readable while scrolling. */}
      <div style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 5, background: 'var(--ink-900)', padding: '10px 0', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--border-400)' }}>
        <strong>{a.title}</strong>
        <span aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums' }}>Time left: <strong>{formatRemaining(left)}</strong></span>
        {sectionLeft != null && <span className="small">Section: {formatRemaining(sectionLeft)}</span>}
        {state.attempt.monitoringChoice === 'camera' && <Badge tone={mon.tone} title={mon.detail}>{mon.label}</Badge>}
        {state.attempt.monitoringChoice === 'alternative' && <Badge tone="muted">No camera (alternative)</Badge>}
        <span style={{ flex: 1 }} />
        {/* Always available: a timed assessment must be submittable at any point (unanswered questions are shown first). */}
        {stage === 'attempt'
          ? <Button onClick={() => setStage('review')} aria-label={`Review and submit, ${answeredTotal} of ${itemTotal} answered`}>Review &amp; submit ({answeredTotal}/{itemTotal})</Button>
          : <Button variant="secondary" onClick={() => setStage('attempt')}>Back to questions</Button>}
      </div>
      {state.attempt.monitoringChoice === 'camera' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: 120, aspectRatio: '4 / 3', borderRadius: 6, background: '#111' }} aria-label="Your camera" />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="small" style={{ flex: 1, minWidth: 220 }} aria-live="polite">
            <strong>{mon.label}.</strong> {mon.detail}
            {mon.canRestart && <div><Button size="sm" variant="secondary" onClick={() => controllerRef.current?.restartCamera()}>Restart camera</Button></div>}
            {mon.canRetry && <div><Button size="sm" variant="secondary" onClick={() => startMonitoring(attemptIdRef.current)}>Try again</Button></div>}
          </div>
        </div>
      )}
      {error && <div className="field-error" role="alert" style={{ margin: '8px 0' }}>{error}</div>}

      <nav aria-label="Sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        {sections.map((s) => (
          <button key={s.id} type="button" className={`btn btn-sm ${s.id === current && stage === 'attempt' ? 'btn-primary' : 'btn-secondary'}`}
            disabled={busy || s.locked} onClick={() => { setStage('attempt'); openSection(s) }}
            aria-current={s.id === current ? 'step' : undefined}>
            {s.position}. {SECTION_LABELS[s.kind]} ({counts[s.id]?.answered ?? 0}/{s.itemCount}){s.locked ? ' - closed' : ''}
          </button>
        ))}
      </nav>

      {stage === 'review' && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Review</h3>
          <ul>{sections.map((s) => <li key={s.id}>{SECTION_LABELS[s.kind]}: {counts[s.id]?.answered ?? 0} of {s.itemCount} answered{s.locked ? ' (closed)' : ''}</li>)}</ul>
          <Button onClick={finalSubmit} disabled={busy}>{busy ? 'Submitting...' : 'Submit assessment'}</Button>
        </Card>
      )}

      {stage === 'attempt' && section && !section.entered && (
        <Card>
          <p style={{ marginTop: 0 }}>{SECTION_LABELS[section.kind]}: {section.itemCount} question(s){section.durationMinutes ? `, ${section.durationMinutes} minutes for this section` : ''}.</p>
          {!section.allowBack && <p className="small">Once you leave this section you cannot come back to it.</p>}
          {section.negativeMarking > 0 && <p className="small">Wrong answers lose {section.negativeMarking * 100}% of the question&apos;s marks; unanswered questions lose nothing.</p>}
          <Button onClick={() => openSection(section)} disabled={busy}>Open section</Button>
        </Card>
      )}
      {stage === 'attempt' && section && section.entered && section.timeOver && <Card><p style={{ margin: 0 }}>Time for this section is over. Your saved answers are kept; move on to the next section.</p></Card>}

      {stage === 'attempt' && section && section.entered && !section.timeOver && section.items.map((item, idx) => (
        <Card key={item.id} style={{ marginBottom: 12 }}>
          {item.question ? (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600 }}>{idx + 1}. {item.question.questionText}</legend>
              <p className="small muted" style={{ margin: '4px 0' }}>{item.marks} mark(s){item.question.questionType === 'multiple' ? ' - choose all that apply' : ''}</p>
              {item.question.choices.map((c) => (
                <label key={c.key} style={{ display: 'block', padding: '4px 0' }}>
                  <input type={item.question.questionType === 'multiple' ? 'checkbox' : 'radio'} name={`q${item.id}`} checked={(answers[item.id] || []).includes(c.key)} onChange={() => choose(item, c.key)} disabled={busy} />
                  {' '}<strong>{c.key}.</strong> {c.text}
                </label>
              ))}
              <span className="small muted" aria-live="polite">{saving[item.id] === 'saving' ? 'Saving...' : saving[item.id] === 'saved' ? 'Saved' : saving[item.id] === 'error' ? 'Not saved - try again' : ''}</span>
            </fieldset>
          ) : (
            <div>
              <h3 style={{ marginTop: 0 }}>{item.coding.title} <span className="small muted">({item.coding.difficulty}, {item.marks} marks)</span></h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{item.coding.description}</p>
              {item.coding.constraints && <p className="small muted">Constraints: {item.coding.constraints}</p>}
              {(item.coding.examples || []).map((ex, i) => <pre key={i} className="mono small" style={{ whiteSpace: 'pre-wrap' }}>Input: {ex.input}{'\n'}Output: {ex.output}</pre>)}
              <div style={{ maxWidth: 200 }}>
                <Select label="Language" value={code[item.id]?.language || 'python'} options={LANGS}
                  onChange={(e) => { const language = e.target.value; setCode((c) => ({ ...c, [item.id]: { language, source: c[item.id]?.source || '' } })); ensureStarter({ ...item }, language) }} />
              </div>
              <div style={{ height: 320, border: '1px solid var(--border-500)', borderRadius: 8, overflow: 'hidden', margin: '8px 0' }} onFocus={() => ensureStarter(item, code[item.id]?.language || 'python')}>
                <CodeEditor language={code[item.id]?.language || 'python'} value={code[item.id]?.source || ''} onChange={(v) => setCode((c) => ({ ...c, [item.id]: { language: c[item.id]?.language || 'python', source: v || '' } }))} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => runSamples(item)} disabled={busy || !code[item.id]?.source?.trim()}>Run sample tests</Button>
                <Button onClick={() => submitCode(item)} disabled={busy || !code[item.id]?.source?.trim()}>Submit solution</Button>
                <span className="small muted" style={{ alignSelf: 'center' }}>{(state.codingRuns || []).filter((r) => r.itemId === item.id).length}/{state.maxCodeRunsPerItem} submissions used. Your best submission counts.</span>
              </div>
              {codeResult[item.id] && (
                <div className="small" style={{ marginTop: 8 }} aria-live="polite">
                  {codeResult[item.id].kind === 'samples'
                    ? <>Sample tests (not recorded): {codeResult[item.id].passedTests}/{codeResult[item.id].totalTests} passed.</>
                    : <>Submitted: {codeResult[item.id].passedTests}/{codeResult[item.id].totalTests} tests passed ({codeResult[item.id].executionStatus.replace('_', ' ')}).
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>{codeResult[item.id].tests.map((t) => <Badge key={t.index} tone={t.passed ? 'success' : 'danger'}>Test {t.index}{t.visible ? '' : ' (hidden)'}: {t.passed ? 'pass' : 'fail'}</Badge>)}</div></>}
                  {codeResult[item.id].stderr && <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{codeResult[item.id].stderr}</pre>}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
