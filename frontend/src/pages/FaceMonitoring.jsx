import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import Panel from '../components/Panel.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import FaceEventTimeline from '../components/FaceEventTimeline.jsx'
import FaceReportView from '../components/FaceReportView.jsx'
import { faceMonitorApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { createFaceMonitorController, makeBrowserCapture, initialState } from '../utils/faceMonitorController.js'
import { formatDuration, liveStatusRows, qualityTips, mergeEvents, reasonText } from '../utils/faceMonitor.js'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'

const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/**
 * Optional, consent-based face behaviour monitoring for PRACTICE sessions. The camera never starts without the explicit consent
 * checkbox; frames are analysed by the server in memory and discarded; the result is a set of observations for a person to review,
 * never a verdict, and it is kept apart from interview and coding scores.
 */
export default function FaceMonitoring() {
  const confirm = useConfirm()
  const toast = useToast()
  const [params] = useSearchParams()
  const interviewId = params.get('interview') && /^\d+$/.test(params.get('interview')) ? Number(params.get('interview')) : null
  const [caps, setCaps] = useState(null)
  const [capsError, setCapsError] = useState('')
  const [sessions, setSessions] = useState([])
  const [consent, setConsent] = useState(false)
  const [identityConsent, setIdentityConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('setup') // setup | live | report
  const [live, setLive] = useState(initialState())
  const [report, setReport] = useState(null)
  const [refStatus, setRefStatus] = useState('')
  const [now, setNow] = useState(Date.now())
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const controllerRef = useRef(null)
  const sessionIdRef = useRef(null)
  const sampleRef = useRef({ at: Date.now(), elapsed: 0 })

  const refreshLists = useCallback(async () => {
    try { setSessions((await faceMonitorApi.listSessions()).sessions || []) } catch { /* the list is optional */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    faceMonitorApi.getCapabilities().then((c) => { if (!cancelled) setCaps(c) }).catch((e) => { if (!cancelled) setCapsError(apiErrorMessage(e, 'Could not check whether face monitoring is available.')) })
    refreshLists()
    return () => { cancelled = true }
  }, [refreshLists])

  // One controller for the page's lifetime; it always releases the camera on unmount.
  useEffect(() => {
    const controller = createFaceMonitorController({
      api: faceMonitorApi,
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
      captureFrame: () => makeBrowserCapture(videoRef.current, canvasRef.current)(),
      attachStream: (stream) => { const v = videoRef.current; if (v) { v.srcObject = stream || null; if (stream) v.play?.().catch(() => {}) } },
      onChange: setLive,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id),
      intervalMs: caps?.frameIntervalMs || 2000,
      describeError: (e) => apiErrorMessage(e, 'The server could not process that frame.'),
    })
    controllerRef.current = controller
    return () => controller.stop()
  }, [caps?.frameIntervalMs])

  useEffect(() => {
    if (view !== 'live') return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [view])

  useEffect(() => { if (live.session) sampleRef.current = { at: Date.now(), elapsed: live.session.elapsedMs || 0 } }, [live.session])

  const runningSession = useMemo(() => sessions.find((s) => s.status === 'active' || s.status === 'paused') || null, [sessions])
  const unavailable = caps && !caps.available
  const identityAvailable = caps?.features?.identity?.state === 'available'

  async function begin(existing) {
    setError(''); setBusy(true); setReport(null); setRefStatus('')
    try {
      let session
      if (existing) {
        const data = await faceMonitorApi.getSession(existing.id)
        session = data.session
        if (session.status === 'paused') session = (await faceMonitorApi.resume(existing.id)).session
        controllerRef.current.applyResult({ session, newEvents: data.events, updatedEvents: [] })
      } else {
        if (!cameraSupported()) throw new Error('This browser cannot access a camera. Try a current version of Chrome, Edge or Firefox over https or localhost.')
        const res = await faceMonitorApi.createSession({ consent: true, identityConsent: identityConsent && identityAvailable, ...(interviewId ? { interviewSessionId: interviewId } : {}) })
        session = res.session
      }
      sessionIdRef.current = session.id
      setView('live')
      await controllerRef.current.start(session.id, session)
    } catch (err) {
      setError(err.response ? apiErrorMessage(err, 'Could not start monitoring.') : (err.message || 'Could not start monitoring.'))
    } finally { setBusy(false); refreshLists() }
  }

  async function pauseResume() {
    const id = sessionIdRef.current
    setBusy(true); setError('')
    try {
      const paused = live.phase === 'paused'
      const res = paused ? await faceMonitorApi.resume(id) : await faceMonitorApi.pause(id)
      controllerRef.current.applyResult(res)
      await controllerRef.current.setPaused(!paused)
    } catch (err) { setError(apiErrorMessage(err, 'Could not change the monitoring state.')) } finally { setBusy(false) }
  }

  async function finish() {
    const id = sessionIdRef.current
    setBusy(true); setError('')
    controllerRef.current.stop() // the camera is released first, whatever happens next
    try {
      const data = await faceMonitorApi.end(id)
      setReport(data); setView('report')
    } catch (err) { setError(apiErrorMessage(err, 'Could not end the session. Try again.')) } finally { setBusy(false); refreshLists() }
  }

  async function takeReference() {
    setRefStatus('Capturing…')
    try {
      const blob = await makeBrowserCapture(videoRef.current, canvasRef.current)()
      if (!blob) { setRefStatus('No picture yet. Wait for the camera preview, then try again.'); return }
      const res = await faceMonitorApi.captureReference(sessionIdRef.current, blob)
      setRefStatus(res.status === 'stored' ? 'Start-of-session photo stored in memory for this session only (never saved).'
        : res.status === 'not_configured' ? 'The face-recognition model is not installed, so the same-person check is not configured.'
          : `The photo could not be used${res.reason ? ` (${reasonText(res.reason)})` : ''}. Face the camera alone in good light and try again.`)
    } catch (err) { setRefStatus(apiErrorMessage(err, 'Could not capture the reference photo.')) }
  }

  async function openReport(id) {
    setBusy(true); setError('')
    try { setReport(await faceMonitorApi.getReport(id)); setView('report') } catch (err) { setError(apiErrorMessage(err, 'Could not load that report.')) } finally { setBusy(false) }
  }
  async function removeSession(id) {
    if (!(await confirm({ title: 'Delete this monitoring session?', message: 'The session and its report will be permanently deleted. This cannot be undone.', confirmLabel: 'Delete session', tone: 'danger' }))) return
    try { await faceMonitorApi.remove(id); if (report?.session?.id === id) { setReport(null); setView('setup') } refreshLists(); toast.success('Monitoring session deleted.') } catch (err) { setError(apiErrorMessage(err, 'Could not delete the session.')) }
  }
  function backToSetup() { setView('setup'); setReport(null); setLive(initialState()); refreshLists() }

  /* ------------------------------------------------------------------ render */
  if (!caps && !capsError) return <LoadingSpinner label="Checking face monitoring…" />

  const session = live.session
  const base = sampleRef.current
  const elapsed = session ? (base.elapsed + (live.phase === 'running' ? Math.max(0, now - base.at) : 0)) : 0

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title="Face behaviour monitoring" description="Optional practice-only camera checks. Observations for you to review, never a verdict, and separate from your interview and coding scores." actions={<Badge tone="violet">Experimental</Badge>} />
      {error && <div className="field-error" role="alert">{error}</div>}

      {view === 'setup' && (
        <>
          {capsError && <div className="field-error" role="alert">{capsError}</div>}
          {unavailable && <div className="notice" role="status"><strong>Not available right now.</strong> {caps.message}{caps.service?.reason ? ` (${caps.service.reason})` : ''}</div>}
          {caps && !unavailable && <FeatureList features={caps.features} />}

          {runningSession && (
            <Panel title="A session is still running">
              <p style={{ marginTop: 0 }}>You have an unfinished monitoring session (started {new Date(runningSession.startedAt).toLocaleString()}). Reloading the page stopped its camera.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button onClick={() => begin(runningSession)} disabled={busy || unavailable}>Continue (restart camera)</Button>
                <Button variant="secondary" onClick={async () => { sessionIdRef.current = runningSession.id; await finish() }} disabled={busy}>End it and see the report</Button>
              </div>
            </Panel>
          )}

          {caps && !runningSession && (
            <Panel title="Before you start">
              <PrivacyNotice privacy={caps.privacy} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '12px 0 6px' }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={unavailable} />
                <span>I agree to camera-based analysis of my face during this practice session, as described above. I can pause, stop or delete it at any time.</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0 12px', opacity: identityAvailable ? 1 : 0.6 }}>
                <input type="checkbox" checked={identityConsent && identityAvailable} onChange={(e) => setIdentityConsent(e.target.checked)} disabled={!identityAvailable || unavailable} />
                <span>Optional: also compare my face with a photo taken at the start (same-person check). {identityAvailable ? 'The photo stays in memory for this session only.' : `Not configured. ${reasonText(caps.features?.identity?.reason)}`}</span>
              </label>
              {interviewId && <p style={{ color: 'var(--text-500)' }}>This session will be linked to practice interview #{interviewId}.</p>}
              <Button onClick={() => begin(null)} disabled={!consent || busy || unavailable}>{busy ? 'Starting…' : 'Start camera and monitoring'}</Button>
            </Panel>
          )}

          {sessions.some((s) => s.status === 'ended') && (
            <Panel title="Earlier sessions">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                {sessions.filter((s) => s.status === 'ended').map((s) => (
                  <li key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{new Date(s.startedAt).toLocaleString()}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="secondary" onClick={() => openReport(s.id)} disabled={busy}>Report</Button>
                      <Button size="sm" variant="danger" onClick={() => removeSession(s.id)}>Delete</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {view === 'live' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <Panel title="Camera" aside={<Badge tone={live.phase === 'running' ? 'success' : live.phase === 'paused' ? 'warning' : 'muted'}>{live.phase === 'running' ? 'Monitoring' : live.phase === 'paused' ? 'Paused' : live.phase === 'starting' ? 'Starting' : 'Stopped'}</Badge>}>
              <div style={{ position: 'relative', background: 'var(--ink-900)', borderRadius: 8, overflow: 'hidden', aspectRatio: '4 / 3' }}>
                {/* The preview is mirrored for comfort only; the frames sent are not. */}
                <video ref={videoRef} muted playsInline autoPlay aria-label="Your camera preview" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: live.camera.state === 'live' ? 'block' : 'none' }} />
                {live.camera.state !== 'live' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center', color: 'var(--text-500)' }}>{live.camera.state === 'starting' ? 'Starting the camera…' : live.phase === 'paused' ? 'Paused. The camera is off.' : 'Camera is off'}</div>}
              </div>
              <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
              {live.camera.state === 'error' && (
                <div className="field-error" role="alert" style={{ marginTop: 10 }}>
                  {live.camera.message}
                  <div style={{ marginTop: 8 }}><Button size="sm" onClick={() => controllerRef.current.restartCamera()}>Restart camera</Button></div>
                </div>
              )}
              {live.lastError && live.camera.state !== 'error' && <div className="notice" role="status" style={{ marginTop: 10 }}>{live.serviceTrouble ? 'The analysis service is not responding, so this time is not measured. ' : ''}{live.lastError}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <Button variant="secondary" onClick={pauseResume} disabled={busy || live.phase === 'starting' || live.phase === 'stopped'}>{live.phase === 'paused' ? 'Resume' : 'Pause'}</Button>
                <Button onClick={finish} disabled={busy}>End and see report</Button>
                {session?.identity?.requested && live.camera.state === 'live' && <Button variant="secondary" onClick={takeReference} disabled={busy}>Take start photo</Button>}
              </div>
              {refStatus && <p role="status" style={{ marginBottom: 0, color: 'var(--text-500)', fontSize: '0.85rem' }}>{refStatus}</p>}
            </Panel>

            <Panel title="Live status">
              <p style={{ margin: '0 0 8px', color: 'var(--text-500)' }}>Elapsed {formatDuration(elapsed)} · {live.framesSent} frame{live.framesSent === 1 ? '' : 's'} analysed</p>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: 0 }} aria-label="Live measurements">
                {liveStatusRows(session?.current, session?.features).map((r) => (
                  <div key={r.key} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--text-500)' }}>{r.label}</dt>
                    <dd style={{ margin: 0 }}><span data-tone={r.tone}>{r.value}</span></dd>
                  </div>
                ))}
              </dl>
              {qualityTips(session?.current).length > 0 && (
                <ul style={{ margin: '10px 0 0', paddingLeft: 18 }} aria-label="Tips to improve the picture">{qualityTips(session.current).map((t) => <li key={t}>{t}</li>)}</ul>
              )}
              {session?.totals && <p style={{ marginBottom: 0, marginTop: 10, color: 'var(--text-500)', fontSize: '0.85rem' }}>Face visible {formatDuration(session.totals.faceVisibleMs)} · no face {formatDuration(session.totals.faceAbsentMs)}{session.totals.framesUnusable ? ` · ${session.totals.framesUnusable} unusable frames (not counted as absence)` : ''}</p>}
            </Panel>
          </div>
          <Panel title="Events so far"><FaceEventTimeline events={live.events} now={now} /></Panel>
          <div className="notice" role="note">Events are observations. A long pause, a turned head or a second person nearby can have ordinary reasons. Nothing here changes your interview or coding scores.</div>
        </>
      )}

      {view === 'report' && report && (
        <>
          <FaceReportView report={report.report} events={report.events} session={report.session} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={backToSetup}>Back</Button>
            <Button variant="danger" onClick={() => removeSession(report.session.id)}>Delete this session and report</Button>
          </div>
        </>
      )}
    </div>
  )
}

function FeatureList({ features }) {
  if (!features) return null
  const rows = [
    ['faceDetection', 'Face detection'], ['multipleFaces', 'Multiple faces'], ['imageQuality', 'Image quality'],
    ['headPose', 'Head direction'], ['gaze', 'Rough gaze'], ['identity', 'Same-person check (optional)'],
  ]
  return (
    <Panel title="What works on this computer">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {rows.map(([k, label]) => {
          const f = features[k] || { state: 'unavailable' }
          return (
            <li key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{label}</span>
              <Badge tone={f.state === 'available' ? 'success' : 'muted'}>{f.state === 'available' ? 'Available' : f.state === 'not_configured' ? 'Not configured' : 'Unavailable'}</Badge>
              {f.state !== 'available' && f.reason && <span style={{ color: 'var(--text-500)', fontSize: '0.85rem' }}>{reasonText(f.reason)}</span>}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function PrivacyNotice({ privacy }) {
  if (!privacy) return null
  const list = (items) => <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>{items.map((i) => <li key={i}>{i}</li>)}</ul>
  return (
    <div>
      <strong>What runs</strong>{list(privacy.runs)}
      <strong>What is stored</strong>{list(privacy.stored)}
      <p style={{ margin: '0 0 8px' }}>Kept for {privacy.retentionDays} days unless you delete it sooner.</p>
      <strong>Please note</strong>{list(privacy.notes)}
    </div>
  )
}
