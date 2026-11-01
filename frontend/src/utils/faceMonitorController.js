/**
 * The browser side of face monitoring: camera ownership and the frame loop, kept free of React so it can be tested with fakes.
 *
 * It owns the MediaStream (and always stops its tracks), captures one small JPEG every `intervalMs`, uploads it, and folds the
 * server's answer into a plain state object. It never decides what the frames mean: the server does the analysis, timing and
 * event creation, and returns the result. A problem on this side (permission, unplugged camera, failed capture, API error) is
 * reported as a technical status, never as behaviour.
 */
import { classifyCameraError, CAMERA_LOST_MESSAGE, mergeEvents } from './faceMonitor.js'

export const CONSTRAINTS = { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }

export function initialState() {
  return {
    phase: 'idle', // idle | starting | running | paused | stopped
    camera: { state: 'off', status: null, message: '' }, // off | starting | live | error
    session: null, events: [], framesSent: 0, lastError: '', serviceTrouble: false, ended: false,
  }
}

/**
 * deps: { api, getUserMedia(constraints), captureFrame(): Promise<Blob|null>, attachStream(stream|null), onChange(state),
 *         setTimer(fn, ms), clearTimer(id), intervalMs, describeError(err) }
 */
export function createFaceMonitorController(deps) {
  const { api, getUserMedia, captureFrame, attachStream, onChange, setTimer, clearTimer, intervalMs = 2000, describeError = (e) => (e && e.message) || 'Request failed.' } = deps
  let state = initialState()
  let stream = null
  let timer = null
  let sessionId = null
  let inFlight = false
  let captureFailing = false
  let generation = 0

  const emit = (patch) => { state = { ...state, ...patch }; onChange(state) }
  const reportStatus = async (status) => { try { const r = await api.reportCameraStatus(sessionId, status); if (r && r.session) applyResult(r) } catch { /* best effort: the page already shows the problem */ } }

  function applyResult(res) {
    if (!res) return
    emit({ session: res.session || state.session, events: mergeEvents(state.events, res.newEvents, res.updatedEvents) })
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => { t.onended = null; try { t.stop() } catch { /* already stopped */ } })
      stream = null
    }
    attachStream(null)
  }

  function schedule() {
    clearTimer(timer)
    timer = setTimer(tick, intervalMs)
  }

  async function openCamera() {
    emit({ camera: { state: 'starting', status: null, message: '' } })
    try {
      stream = await getUserMedia(CONSTRAINTS)
    } catch (err) {
      const c = classifyCameraError(err)
      emit({ camera: { state: 'error', status: c.status, message: c.message } })
      await reportStatus(c.status)
      return false
    }
    const my = generation
    stream.getVideoTracks().forEach((t) => {
      t.onended = () => {
        if (my !== generation || !stream) return
        stopStream()
        captureFailing = false
        emit({ camera: { state: 'error', status: 'track_ended', message: CAMERA_LOST_MESSAGE } })
        reportStatus('track_ended')
      }
    })
    attachStream(stream)
    emit({ camera: { state: 'live', status: null, message: '' } })
    return true
  }

  async function tick() {
    if (state.phase !== 'running' || inFlight) { if (state.phase === 'running') schedule(); return }
    if (state.camera.state !== 'live') { schedule(); return }
    inFlight = true
    const my = generation
    try {
      let blob = null
      try { blob = await captureFrame() } catch { blob = null }
      if (my !== generation) return
      if (!blob) {
        if (!captureFailing) { captureFailing = true; await reportStatus('capture_failed') }
        emit({ lastError: 'Could not capture a picture from the camera.' })
        return
      }
      captureFailing = false
      const res = await api.submitFrame(sessionId, blob)
      if (my !== generation) return
      applyResult(res)
      emit({ framesSent: state.framesSent + 1, lastError: '', serviceTrouble: false })
    } catch (err) {
      if (my !== generation) return
      const code = err && err.response && err.response.data && (err.response.data.reason)
      const http = err && err.response && err.response.status
      if (http === 409 || http === 404) {
        // The session ended or paused elsewhere: stop quietly rather than keep sending frames.
        stopStream(); clearTimer(timer); timer = null
        emit({ phase: 'stopped', ended: true, camera: { state: 'off', status: null, message: '' }, lastError: describeError(err), serviceTrouble: false })
        return
      }
      emit({ lastError: describeError(err), serviceTrouble: http === 503 || http === 502 || !http, errorCode: code || null })
    } finally {
      inFlight = false
      if (my === generation && state.phase === 'running') schedule()
    }
  }

  return {
    getState: () => state,
    /** Opens the camera for an already-created, consented session and begins the frame loop. */
    async start(id, session) {
      generation += 1
      sessionId = id
      state = { ...initialState(), phase: 'starting', session: session || null }
      onChange(state)
      const ok = await openCamera()
      if (!ok) { emit({ phase: 'stopped' }); return false }
      emit({ phase: 'running' })
      schedule()
      return true
    },
    /** Camera error recovery: tries to open the camera again inside the same session. */
    async restartCamera() {
      if (!sessionId || state.phase === 'idle') return false
      stopStream()
      const ok = await openCamera()
      if (ok && state.phase === 'stopped') emit({ phase: 'running' })
      if (ok && state.phase === 'running') schedule()
      return ok
    },
    /** Pausing releases the camera (nothing is captured or kept open); resuming opens it again. Returns false if the camera could not reopen. */
    async setPaused(paused) {
      if (state.phase !== 'running' && state.phase !== 'paused') return true
      if (paused) {
        generation += 1
        clearTimer(timer); timer = null
        stopStream()
        inFlight = false
        emit({ phase: 'paused', camera: { state: 'off', status: null, message: '' } })
        return true
      }
      emit({ phase: 'running' })
      const ok = await openCamera() // a failure is reported as a technical status and shown with "Restart camera"
      schedule()
      return ok
    },
    applyResult,
    /** Always releases the camera. Safe to call repeatedly (end of session, route change, unmount). */
    stop() {
      generation += 1
      clearTimer(timer); timer = null
      stopStream()
      inFlight = false
      emit({ phase: state.phase === 'idle' ? 'idle' : 'stopped', camera: { state: 'off', status: null, message: '' } })
    },
    tick,
  }
}

/** Draws the current video frame to a canvas and returns a small JPEG Blob (or null if the video has no picture yet). */
export function makeBrowserCapture(videoEl, canvasEl, quality = 0.7) {
  return () => new Promise((resolve) => {
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight || videoEl.readyState < 2) { resolve(null); return }
    const scale = Math.min(1, 640 / videoEl.videoWidth)
    canvasEl.width = Math.round(videoEl.videoWidth * scale)
    canvasEl.height = Math.round(videoEl.videoHeight * scale)
    const ctx = canvasEl.getContext('2d')
    if (!ctx) { resolve(null); return }
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height)
    canvasEl.toBlob((b) => resolve(b || null), 'image/jpeg', quality)
  })
}
