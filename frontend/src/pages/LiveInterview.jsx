import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import QuestionCard from '../components/QuestionCard.jsx'
import ProgressBar from '../components/ProgressBar.jsx'
import Timer from '../components/Timer.jsx'
import Button from '../components/Button.jsx'
import Card from '../components/Card.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { interviewApi } from '../services/api.js'
import { createTypingTracker } from '../utils/typingTracker.js'
import { describeAiError } from '../utils/aiErrors.js'
import FollowUpPanel from '../components/FollowUpPanel.jsx'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'
import { interviewProgress } from '../utils/interviewProgress.js'

// Tried in preference order; the browser picks the first one it actually
// supports. Never assume a single format works everywhere — Chrome/Firefox
// support webm/opus, Safari generally does not and falls back to mp4.
const PREFERRED_AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const PREFERRED_VIDEO_MIME_TYPES = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']

function pickSupportedMimeType(candidates) {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
  // undefined here means "let the browser pick its own default" — MediaRecorder accepts no mimeType option too.
}

const VISION_STATUS_DESCRIPTIONS = {
  model_unavailable: 'Face presence was measured; head-pose/gaze detection is not available in this deployment.',
  complete: 'Visual signals measured for this answer.',
}

/**
 * Phase 6/7: text questions/answers are real, persisted via
 * GET/POST /api/interviews/:id(/answer). Scoring comes from the real
 * Phase 7 Python NLP evaluator (concept-matching + TF-IDF — not an LLM).
 * The backend decides what the next question is and when the session is
 * complete; this page never computes that itself.
 *
 * Phase 10: voice mode is now real too — MediaRecorder captures audio,
 * which is submitted via POST /interviews/:id/answer/audio (multipart).
 * Python transcribes it and evaluates the transcript with the exact same
 * evaluator used for typed answers, plus returns speech metrics. Text and
 * voice are two separate submission paths that both end up producing the
 * same shape of stored answer.
 *
 * Phase 11: OPTIONAL webcam analysis. The clip is recorded WHILE the candidate answers and attached to the saved
 * answer afterwards; camera access is never
 * requested automatically: the candidate is asked once before the first question, and the camera only starts after "Yes".
 * A short clip is sent to POST /interviews/:id/answer/video, which
 * attaches cv_metrics (measurable visual signals only — never emotion,
 * attention, or personality judgments) to that same answer. This never
 * replaces or competes with the text/voice content answer.
 */
export default function LiveInterview() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const answerMode = location.state?.setup?.answerMode || 'text'
  // Present only when this practice session was created with personalise/adaptive options (shown once, not stored).
  const personalization = location.state?.personalization || null

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // Follow-ups exist only for practice sessions; the backend omits `followUps` for hiring assessments.
  const [isPractice, setIsPractice] = useState(false)
  const [questions, setQuestions] = useState([])
  const [currentQuestion, setCurrentQuestion] = useState(null)
  const [answerText, setAnswerText] = useState('')
  const [answered, setAnswered] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitRetryable, setSubmitRetryable] = useState(false)
  const [skippedNow, setSkippedNow] = useState(false) // this question was just skipped (not answered)
  const [submittingKind, setSubmittingKind] = useState('') // 'evaluate' | 'skip' while a request is in flight, so the wait is described correctly
  const [ending, setEnding] = useState(false)
  // Text answers: counts/timings of how the answer was typed (never the keys themselves). Practice analytics only.
  const typingTrackerRef = useRef(createTypingTracker())
  // What the AI service can do right now (speech model state, camera analysis level); null while unknown.
  const [capabilities, setCapabilities] = useState(null)
  // Voice answers: optionally record the camera WHILE answering so the clip covers the whole answer.
  const [recordWithCamera, setRecordWithCamera] = useState(false)
  const lastAudioBlobRef = useRef(null)      // kept so a failed upload can be retried without re-recording
  const pendingVideoBlobRef = useRef(null)
  const answerVideoRecorderRef = useRef(null)
  const answerVideoChunksRef = useRef([])

  // --- voice mode state ---
  const mediaRecorderSupported = typeof MediaRecorder !== 'undefined'
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingAudio, setIsProcessingAudio] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [micError, setMicError] = useState('')
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordingTimerRef = useRef(null)

  // --- optional webcam (CV) state ---
  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  const [isProcessingVideo, setIsProcessingVideo] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [videoSubmitError, setVideoSubmitError] = useState('')
  const [visionResult, setVisionResult] = useState(null)
  const cameraKey = `aic-camera-${id}`
  const [cameraChoice, setCameraChoice] = useState(() => {
    try { const v = sessionStorage.getItem(`aic-camera-${id}`); return v === 'no' ? 'no' : 'unset' } catch { return 'unset' } // a refresh loses the live stream, so a "yes" is asked again
  })
  const interviewStreamRef = useRef(null)
  const textRecorderRef = useRef(null)
  const textChunksRef = useRef([])
  const livePreviewRef = useRef(null)

  const busy = submitting || isRecording || isProcessingAudio || isProcessingVideo || ending

  // Work that exists only in this browser and would be lost by leaving: an unsent typed answer or a recording in progress.
  // Answers that were already submitted are saved on the server, so leaving after those is always safe and is never blocked.
  const unsentWork = !loading && !answered && (answerText.trim().length > 0 || isRecording || isProcessingAudio || submitting || isProcessingVideo)

  // Closing or reloading the tab: the browser's own "Leave site?" prompt.
  useEffect(() => {
    if (!unsentWork) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsentWork])

  // Clicking a link inside the app (sidebar, etc.) while there is unsent work: ask first. The browser Back button and the Log out
  // button are not intercepted; answers already submitted are saved either way.
  useEffect(() => {
    if (!unsentWork) return undefined
    const onClick = async (ev) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      let url
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      ev.preventDefault(); ev.stopPropagation()
      const leave = await confirm({
        title: 'Leave this interview?',
        message: 'You have an answer that has not been submitted yet. If you leave now, it will be lost. Questions you already answered stay saved and you can resume this interview later.',
        confirmLabel: 'Leave interview', cancelLabel: 'Stay here', tone: 'danger',
      })
      if (leave) navigate(url.pathname + url.search + url.hash)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [unsentWork, confirm, navigate])

  const loadInterview = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const detail = await interviewApi.getInterview(id)
      if (detail.session.status === 'completed') {
        navigate(`/interview/${id}/results`, { replace: true })
        return
      }
      setQuestions(detail.questions)
      setIsPractice(Array.isArray(detail.followUps))
      const firstUnanswered = detail.questions.find((q) => !q.answered) || null
      if (!firstUnanswered) {
        // Every question already has an answer (e.g. the user refreshed
        // right after submitting the last one, before hitting complete).
        // The backend, not this page, decides completion — call it, then
        // go straight to results either way.
        try {
          await interviewApi.completeInterview(id)
        } catch {
          // Ignore — if it's already completed this just 409s harmlessly.
        }
        navigate(`/interview/${id}/results`, { replace: true })
        return
      }
      setCurrentQuestion(firstUnanswered)
      typingTrackerRef.current.reset()
    } catch (err) {
      if (err.response?.status === 404) setLoadError('This interview could not be found.')
      else setLoadError('Could not load this interview. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => {
    loadInterview()
  }, [loadInterview])

  // Ask the backend (which asks the AI service) what is available, so problems are shown BEFORE someone records an answer.
  useEffect(() => {
    if (answerMode !== 'voice') return undefined
    let cancelled = false
    const check = () => interviewApi.getCapabilities().then((c) => { if (!cancelled) setCapabilities(c) }).catch(() => { if (!cancelled) setCapabilities({ reachable: false, reason: 'backend_unreachable' }) })
    check()
    // While the speech model is still loading, look again every few seconds until it is ready.
    const timer = setInterval(() => { if (capabilitiesRef.current?.speech?.state === 'loading' || capabilitiesRef.current?.speech?.state === 'not_loaded') check() }, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [answerMode])
  const capabilitiesRef = useRef(null)
  capabilitiesRef.current = capabilities

  // Stop any live microphone/camera stream if the user navigates away mid-recording.
  useEffect(() => {
    return () => {
      stopMediaTracks()
      stopInterviewCamera()
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopMediaTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  function stopInterviewCamera() {
    const rec = textRecorderRef.current
    textRecorderRef.current = null
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop() } catch { /* already stopped */ } }
    interviewStreamRef.current?.getTracks().forEach((track) => track.stop())
    interviewStreamRef.current = null
    if (livePreviewRef.current) livePreviewRef.current.srcObject = null
  }

  function showSubmitError(err, fallback) {
    const info = describeAiError(err, fallback)
    setSubmitError(info.message)
    setSubmitRetryable(info.retryable)
  }

  async function handleSubmitAnswer(e) {
    e.preventDefault()
    setSubmittingKind('evaluate')
    setSubmitting(true)
    setSubmitError('')
    setSubmitRetryable(false)
    // Camera (only if the candidate said yes up front): the clip was recorded while they typed; stop it now.
    const clip = cameraChoice === 'yes' && answerMode !== 'voice' ? await stopTextRecorder() : null
    try {
      const result = await interviewApi.submitInterviewAnswer(id, {
        questionId: currentQuestion.id,
        answerText,
        typingMetrics: typingTrackerRef.current.snapshot(),
      })
      setAnswered(true)
      markDone(result)
      // Stashed on the question object itself so "Next Question" below can read it without another round trip.
      setCurrentQuestion((q) => ({ ...q, _result: result }))
      // The answer is saved first; attaching the clip afterwards can never lose it.
      if (clip) await handleSubmitVideoAnswer(clip, result)
    } catch (err) {
      showSubmitError(err, 'Could not submit your answer. Please try again.')
      if (cameraChoice === 'yes' && answerMode !== 'voice') startTextRecorder() // keep recording for the retry
    } finally {
      setSubmitting(false)
    }
  }

  async function startRecording() {
    setSubmitError('')
    setSubmitRetryable(false)
    setMicError('')
    setVideoSubmitError('')
    audioChunksRef.current = []
    answerVideoChunksRef.current = []
    pendingVideoBlobRef.current = null
    lastAudioBlobRef.current = null
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: recordWithCamera && cameraSupported })
    } catch (err) {
      // If only the camera was refused, fall back to audio-only rather than blocking the answer.
      if (recordWithCamera) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          setRecordWithCamera(false)
          setCameraError('The camera could not be used, so this answer is audio-only.')
        } catch (err2) { err = err2 }
      }
      if (!stream) {
        setMicError(
          err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
            ? 'Microphone access was denied. Allow microphone access to record a voice answer, or switch to text mode.'
            : 'Could not access the microphone. Please try again or switch to text mode.',
        )
        return
      }
    }
    try {
      streamRef.current = stream
      // Separate recorders: an audio-only stream for speech (small, easy to transcribe) and a video-only stream for the camera clip.
      const audioStream = new MediaStream(stream.getAudioTracks())
      const mimeType = pickSupportedMimeType(PREFERRED_AUDIO_MIME_TYPES)
      const recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        lastAudioBlobRef.current = blob
        // Give the video recorder a moment to flush its last chunk before the tracks are released.
        setTimeout(() => {
          stopMediaTracks()
          handleSubmitAudioAnswer(blob)
        }, 150)
      }

      answerVideoRecorderRef.current = null
      if (stream.getVideoTracks().length > 0) {
        const vType = pickSupportedMimeType(PREFERRED_VIDEO_MIME_TYPES)
        const vStream = new MediaStream(stream.getVideoTracks())
        const vRec = vType ? new MediaRecorder(vStream, { mimeType: vType }) : new MediaRecorder(vStream)
        vRec.ondataavailable = (e) => { if (e.data && e.data.size > 0) answerVideoChunksRef.current.push(e.data) }
        vRec.onstop = () => {
          if (answerVideoChunksRef.current.length) pendingVideoBlobRef.current = new Blob(answerVideoChunksRef.current, { type: vRec.mimeType || vType || 'video/webm' })
        }
        answerVideoRecorderRef.current = vRec
        vRec.start(1000)
      }

      recorder.start()
      setIsRecording(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    } catch {
      stopMediaTracks()
      setMicError('Recording could not be started in this browser. Please try again or switch to text mode.')
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    setIsRecording(false)
    if (answerVideoRecorderRef.current && answerVideoRecorderRef.current.state !== 'inactive') answerVideoRecorderRef.current.stop()
    mediaRecorderRef.current?.stop() // triggers onstop above, which submits the audio (and then the camera clip, if any)
  }

  async function handleSubmitAudioAnswer(blob) {
    setIsProcessingAudio(true)
    setSubmitError('')
    setSubmitRetryable(false)
    let result
    try {
      result = await interviewApi.submitAudioAnswer(id, currentQuestion.id, blob)
    } catch (err) {
      showSubmitError(err, 'Could not process your recording. Please try again.')
      setIsProcessingAudio(false)
      return
    }
    setAnswered(true)
    markDone(result)
    setCurrentQuestion((q) => ({ ...q, _result: result }))
    lastAudioBlobRef.current = null
    // The answer is saved at this point. The camera clip (if one was recorded alongside) is attached afterwards, and a
    // failure there never loses the answer.
    const clip = pendingVideoBlobRef.current
    pendingVideoBlobRef.current = null
    if (clip) await handleSubmitVideoAnswer(clip, result)
    setIsProcessingAudio(false)
  }

  function retryAudioUpload() {
    if (lastAudioBlobRef.current) handleSubmitAudioAnswer(lastAudioBlobRef.current)
  }

  // ---- Camera: asked ONCE before the interview, then recorded while each answer is typed/spoken ----
  // The choice is remembered for this session only (sessionStorage); the camera is never started without a "Yes" click.
  function chooseCamera(yes) {
    setCameraError('')
    try { sessionStorage.setItem(cameraKey, yes ? 'yes' : 'no') } catch { /* private mode: the choice just is not remembered */ }
    if (!yes) { setCameraChoice('no'); return }
    if (answerMode === 'voice') { setRecordWithCamera(true); setCameraChoice('yes'); return } // voice mode records its camera alongside the microphone
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
      interviewStreamRef.current = stream
      setCameraChoice('yes')
    }).catch((err) => {
      setCameraChoice('no')
      setCameraError(err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        ? 'Camera access was denied, so the interview continues without visual analysis.'
        : 'The camera could not be used, so the interview continues without visual analysis.')
    })
  }

  function startTextRecorder() {
    const stream = interviewStreamRef.current
    if (!stream || textRecorderRef.current) return
    try {
      const mimeType = pickSupportedMimeType(PREFERRED_VIDEO_MIME_TYPES)
      const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 250000 })
      textChunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) textChunksRef.current.push(e.data) }
      rec.start(1000)
      textRecorderRef.current = rec
    } catch { textRecorderRef.current = null } // recording is a bonus; never block the answer
  }

  /** Stops the per-question recorder and resolves with the clip (or null). */
  function stopTextRecorder() {
    const rec = textRecorderRef.current
    textRecorderRef.current = null
    if (!rec || rec.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = textChunksRef.current.length ? new Blob(textChunksRef.current, { type: rec.mimeType || 'video/webm' }) : null
        textChunksRef.current = []
        resolve(blob)
      }
      rec.stop()
    })
  }

  async function handleSubmitVideoAnswer(blob, answerResult) {
    setIsProcessingVideo(true)
    setVideoSubmitError('')
    try {
      const result = await interviewApi.submitVideoAnswer(id, currentQuestion.id, blob)
      setVisionResult(result.answer?.cv_metrics || null)
    } catch (err) {
      const info = describeAiError(err, 'Could not analyse the camera recording. Your answer was saved without it.')
      setVideoSubmitError(info.message)
    } finally {
      setIsProcessingVideo(false)
    }
  }

  // Keeps this page's list of questions in step with what the backend now holds, so going back shows the right status.
  function markDone(result) {
    setQuestions((qs) => qs.map((x) => (x.id === currentQuestion.id ? { ...x, answered: true, answer: result.answer } : x)))
  }

  function discardTextRecorder() {
    const rec = textRecorderRef.current
    textRecorderRef.current = null
    textChunksRef.current = []
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop() } catch { /* already stopped */ } }
  }

  /** Opens any question (the next one, an earlier one to answer again, ...) with a clean answer form. */
  function openQuestion(q) {
    discardTextRecorder() // a camera clip must only ever cover the question it was recorded for
    setCurrentQuestion(questions.find((x) => x.id === q.id) || q)
    typingTrackerRef.current.reset()
    setSubmitError('')
    setSubmitRetryable(false)
    setAnswerText('')
    setAnswered(false)
    setSkippedNow(false)
    setRecordingSeconds(0)
    setVisionResult(null)
    setVideoSubmitError('')
    lastAudioBlobRef.current = null
    pendingVideoBlobRef.current = null
  }

  async function handleSkip() {
    setSubmittingKind('skip')
    setSubmitting(true)
    setSubmitError('')
    setSubmitRetryable(false)
    try {
      const result = await interviewApi.skipInterviewQuestion(id, currentQuestion.id)
      discardTextRecorder()
      markDone(result)
      if (result.nextQuestion && !result.sessionComplete) {
        openQuestion(result.nextQuestion) // straight to the next question, no in-between screen
      } else {
        // Last open question: nothing to move on to, so show the finish button.
        setAnswered(true)
        setSkippedNow(true)
        setCurrentQuestion((q) => ({ ...q, _result: result }))
      }
    } catch (err) {
      showSubmitError(err, 'Could not skip this question. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const currentIndex = questions.findIndex((q) => q.id === currentQuestion?.id)
  const previousQuestion = currentIndex > 0 ? questions[currentIndex - 1] : null
  const previouslyDone = !!(currentQuestion && questions.find((q) => q.id === currentQuestion.id)?.answered)
  const previouslySkipped = previouslyDone && questions.find((q) => q.id === currentQuestion.id)?.answer?.evaluation_meta?.skipped === true

  /** Moves on without changing this question: to the next one in order, else the first one still unanswered, else the end. */
  async function handleForwardWithoutAnswering() {
    const nextInOrder = currentIndex >= 0 ? questions[currentIndex + 1] : null
    const target = nextInOrder || questions.find((q) => !q.answered) || null
    if (target) { openQuestion(target); return }
    try { await interviewApi.completeInterview(id) } catch { /* the results page shows whatever state the backend has */ }
    navigate(`/interview/${id}/results`)
  }

  /** Ends the interview early after confirmation: every question without an answer is skipped (counts as 0), then the interview is completed. */
  async function handleEndInterview() {
    const p = interviewProgress(questions, currentQuestion?.id)
    const unanswered = questions.filter((q) => !q.answered)
    const ok = await confirm({
      title: 'End this interview now?',
      message: (
        <>
          <p style={{ margin: '0 0 8px' }}>You have completed {p.done} of {p.total} questions.</p>
          {unanswered.length > 0
            ? <p style={{ margin: '0 0 8px' }}>The {unanswered.length} unanswered question{unanswered.length === 1 ? '' : 's'} will be marked as skipped and count as 0 in your score.</p>
            : <p style={{ margin: '0 0 8px' }}>All questions already have an answer.</p>}
          {answerText.trim() && !answered && <p style={{ margin: '0 0 8px' }}>The text in the answer box has not been submitted and will not be saved.</p>}
          <p style={{ margin: 0 }}>Answers you already submitted are kept. This cannot be undone.</p>
        </>
      ),
      confirmLabel: 'End interview', cancelLabel: 'Keep going', tone: 'danger',
    })
    if (!ok) return
    setEnding(true)
    setSubmitError('')
    try {
      discardTextRecorder()
      for (const q of unanswered) await interviewApi.skipInterviewQuestion(id, q.id)
      try { await interviewApi.completeInterview(id) } catch (err) { if (err.response?.status !== 409) throw err }
      navigate(`/interview/${id}/results`)
    } catch (err) {
      setEnding(false)
      showSubmitError(err, 'Could not end the interview. Nothing was lost; please try again.')
      toast.error('Could not end the interview. Please try again.')
    }
  }

  async function handleNext() {
    const { nextQuestion, sessionComplete } = currentQuestion._result
    if (sessionComplete) {
      try {
        await interviewApi.completeInterview(id)
      } catch {
        // If completion fails, the results page will show whatever state
        // the backend actually has rather than silently pretending it worked.
      }
      navigate(`/interview/${id}/results`)
      return
    }
    openQuestion(nextQuestion)
  }

  // Camera recording runs only while a question is open and only after an explicit "Yes".
  useEffect(() => {
    if (cameraChoice === 'yes' && answerMode !== 'voice' && currentQuestion?.id && !answered) startTextRecorder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraChoice, currentQuestion?.id, answered])
  useEffect(() => {
    if (livePreviewRef.current && interviewStreamRef.current) livePreviewRef.current.srcObject = interviewStreamRef.current
  }, [cameraChoice, currentQuestion?.id, answered])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <LoadingSpinner label="Loading interview..." />
      </div>
    )
  }

  if (loadError) {
    return (
      <Card>
        <p style={{ margin: 0 }}>{loadError}</p>
        <Button variant="secondary" style={{ marginTop: 12 }} onClick={() => navigate('/interview/setup')}>
          Back to setup
        </Button>
      </Card>
    )
  }

  if (cameraSupported && cameraChoice === 'unset') {
    return (
      <div>
        <h1 style={{ fontSize: '1.3rem', marginBottom: 16 }}>Interview session #{id}</h1>
        <Card>
          <h3 style={{ marginTop: 0 }}>Use your camera for delivery feedback?</h3>
          <p style={{ color: 'var(--text-300)' }}>
            Optional. If you say yes, the camera records while you answer and each clip is analysed for face visibility and, if the face model is installed, head and gaze direction.
            It measures numbers only, not emotion, confidence or personality, counts for a small, capped share of your practice score (shown in the breakdown), and is never shown to employers. The camera stays off unless you choose Yes.
          </p>
          {cameraError && <div className="field-error" role="alert" style={{ marginBottom: 10 }}>{cameraError}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button onClick={() => chooseCamera(true)}>Yes, use my camera</Button>
            <Button variant="secondary" onClick={() => chooseCamera(false)}>No thanks, continue without</Button>
          </div>
        </Card>
      </div>
    )
  }

  const total = questions.length
  const questionNumber = questions.findIndex((q) => q.id === currentQuestion?.id) + 1
  const progress = interviewProgress(questions, currentQuestion?.id)
  // Only states the page really knows about: nothing here is guessed.
  const micStatus = answerMode !== 'voice' ? null
    : !mediaRecorderSupported ? { tone: 'warn', text: 'Microphone: recording not supported in this browser' }
      : micError ? { tone: 'warn', text: 'Microphone: problem, see message below' }
        : isRecording ? { tone: 'live', text: 'Microphone: recording' }
          : isProcessingAudio ? { tone: 'busy', text: 'Transcribing your answer' }
            : { tone: 'idle', text: 'Microphone: ready (starts when you press Start Recording)' }
  const cameraStatus = cameraChoice === 'yes' ? { tone: answerMode === 'voice' ? (isRecording ? 'live' : 'idle') : (answered ? 'idle' : 'live'), text: answerMode === 'voice' ? (isRecording ? 'Camera: recording with your answer' : 'Camera: will record with your answer') : (answered ? 'Camera: clip sent for analysis' : 'Camera: recording this answer') }
    : cameraSupported ? { tone: 'idle', text: 'Camera: off (you chose not to use it)' } : null

  return (
    <div>
      <div className="live-head">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '1.3rem', margin: 0 }}>Interview session #{id}</h1>
          <p className="live-sub" aria-live="polite">
            Question {questionNumber} of {total} · {progress.answered} answered · {progress.skipped} skipped · {progress.remaining} to go
          </p>
        </div>
        <div className="live-timer" role="timer" aria-label="Time on this question">
          <span className="small muted">This question</span>
          <Timer key={currentQuestion?.id} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <ProgressBar value={progress.done} max={Math.max(total, 1)} label={`${progress.done} of ${total} questions completed`} />
        <div className="small muted" style={{ marginTop: 4 }}>{progress.done} of {total} questions completed ({progress.percent}%)</div>
      </div>

      {(micStatus || cameraStatus) && (
        <div className="status-row" aria-label="Recording status">
          {micStatus && <span className={`status-chip status-${micStatus.tone}`}>{micStatus.text}</span>}
          {cameraStatus && <span className={`status-chip status-${cameraStatus.tone}`}>{cameraStatus.text}</span>}
        </div>
      )}

      {personalization && (
        <Card style={{ marginBottom: 16 }}>
          {personalization.difficultyReason && <p style={{ margin: '0 0 6px', fontSize: '0.85rem' }}>{personalization.difficultyReason}</p>}
          {personalization.personalized && (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-300)' }}>
              Why this question: {(personalization.questionReasons?.find((r) => r.questionId === currentQuestion?.id)?.reasons || ['Core question at this difficulty']).join('; ')}.
            </p>
          )}
        </Card>
      )}

      {cameraChoice === 'yes' && answerMode !== 'voice' && !answered && (
        <div style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <video ref={livePreviewRef} autoPlay muted playsInline style={{ width: 120, borderRadius: 8 }} />
          <span className="small muted">Camera on: recording while you answer. It is sent with your answer for delivery feedback.</span>
        </div>
      )}
      <QuestionCard
        question={{ topic: 'Question', text: currentQuestion.question_text }}
        questionNumber={questionNumber}
        total={total}
      />

      {previouslyDone && !answered && (
        <Card style={{ marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            {previouslySkipped
              ? 'You skipped this question, so it currently counts as 0. Answer it now to replace that.'
              : 'You already answered this question. Answering again replaces that answer in your score; the earlier attempt is kept in your results history.'}
          </p>
        </Card>
      )}

      <Card style={{ marginTop: 16 }}>
        {answerMode === 'voice' ? (
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-500)', marginBottom: 10 }}>
              Voice answer
            </label>

            {capabilities && <SpeechStatusBanner capabilities={capabilities} />}

            {!mediaRecorderSupported ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <p style={{ margin: 0 }}>Voice recording is not supported in this browser. Please switch to text mode from setup.</p>
              </div>
            ) : (
              <div className="empty-state" style={{ padding: 24 }}>
                <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>🎙️</div>

                {isRecording ? (
                  <>
                    <p style={{ margin: '0 0 12px', color: 'var(--danger)' }}>
                      Recording... {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                    </p>
                    <Button variant="danger" onClick={stopRecording}>Stop Recording</Button>
                  </>
                ) : isProcessingAudio ? (
                  <LoadingSpinner label="Processing your recording..." />
                ) : (
                  <>
                    <p style={{ margin: '0 0 12px', color: 'var(--text-500)' }}>
                      {answered ? 'Answer recorded.' : 'Record your spoken answer to this question.'}
                    </p>
                    <Button onClick={startRecording} disabled={answered || busy}>Start Recording</Button>
                  </>
                )}

                {cameraSupported && !isRecording && !isProcessingAudio && !answered && recordWithCamera && capabilities?.vision?.state === 'unavailable' && (
                  <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-500)' }}>Camera analysis is not installed on the AI service, so the clip would be rejected. Your voice answer is unaffected.</p>
                )}
                {micError && <div className="field-error" style={{ marginTop: 12 }}>{micError}</div>}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmitAnswer}>
            <div className="field">
              <label htmlFor="answerText">Your answer</label>
              <textarea
                id="answerText"
                className="input"
                rows={6}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                onKeyDown={(e) => typingTrackerRef.current.onKeyDown(e)}
                onPaste={(e) => typingTrackerRef.current.onPaste(e.clipboardData?.getData('text')?.length || 0)}
                placeholder="Type your answer..."
                disabled={answered || submitting}
              />
            </div>
            <Button type="submit" block disabled={answered || submitting || !answerText.trim()}>
              {submitting ? (submittingKind === 'skip' ? 'Skipping...' : 'Evaluating...') : answered ? 'Answer recorded' : previouslyDone ? 'Submit new answer' : 'Submit Answer'}
            </Button>
            {submitting && <div style={{ marginTop: 10 }} role="status"><LoadingSpinner label={submittingKind === 'skip' ? 'Skipping this question...' : 'Evaluating your answer (this can take a few seconds)...'} /></div>}
          </form>
        )}

        {submitError && (
          <div className="field-error" role="alert" style={{ marginTop: 10 }}>
            {submitError}
            {answerMode === 'voice' && submitRetryable && lastAudioBlobRef.current && !busy && (
              <div style={{ marginTop: 8 }}><Button variant="secondary" onClick={retryAudioUpload}>Try again with the same recording</Button></div>
            )}
          </div>
        )}

        {answered && !skippedNow && currentQuestion?._result?.answer?.evaluation_meta?.answerQuality && (
          <div className="answer-feedback" role="status">
            <span className="badge">{currentQuestion._result.answer.evaluation_meta.answerQuality.label || 'Answer evaluated'}</span>
            {currentQuestion._result.answer.evaluation_meta.confidence && (
              <span className="small muted">Evaluation confidence: {currentQuestion._result.answer.evaluation_meta.confidence} (how far the automatic check can be trusted, separate from the answer quality)</span>
            )}
            {currentQuestion._result.answer.evaluation_meta.answerQuality.status === 'not_evaluable' && (
              <span className="small">{(currentQuestion._result.answer.evaluation_meta.answerQuality.reasons || [])[0]} You can go back and answer again.</span>
            )}
          </div>
        )}

        {answered && (
          <div style={{ marginTop: 14, fontSize: '0.85rem', color: 'var(--text-500)' }}>
            {skippedNow
              ? 'Question skipped. It counts as 0 unless you come back and answer it before finishing.'
              : answerMode === 'voice'
                ? 'Answer transcribed and scored by the AI evaluation service.'
                : 'Answer scored by the AI evaluation service.'}
          </div>
        )}
      </Card>

      <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Button variant="secondary" onClick={() => openQuestion(previousQuestion)} disabled={!previousQuestion || busy}>
          Previous question
        </Button>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={handleEndInterview} disabled={busy}>End interview</Button>
          {!answered && !previouslyDone && (
            <Button variant="secondary" onClick={handleSkip} disabled={busy}>Skip question</Button>
          )}
          {!answered && previouslyDone && (
            <Button variant="secondary" onClick={handleForwardWithoutAnswering} disabled={busy}>
              {previouslySkipped ? 'Continue without answering' : 'Keep my answer and continue'}
            </Button>
          )}
        </div>
      </div>

      {answered && isPractice && currentQuestion?.id && (
        // key: a fresh panel (no stale turns) for every question
        <FollowUpPanel key={currentQuestion.id} sessionId={id} questionId={currentQuestion.id} />
      )}

      {answered && cameraChoice === 'yes' && (visionResult || isProcessingVideo || videoSubmitError) && (
        <Card style={{ marginTop: 16 }}>
          <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-500)', marginBottom: 10 }}>Visual analysis</label>
          {isProcessingVideo ? (
            <LoadingSpinner label="Analyzing your camera recording..." />
          ) : visionResult ? (
            <div>
              <p style={{ margin: '0 0 6px' }}>
                <span className="badge">{visionResult.analysisStatus === 'complete' ? 'Analyzed' : 'Partially analyzed'}</span>
              </p>
              <p style={{ margin: 0, color: 'var(--text-500)', fontSize: '0.82rem' }}>
                {VISION_STATUS_DESCRIPTIONS[visionResult.analysisStatus] || 'Visual analysis recorded.'}
              </p>
            </div>
          ) : null}
          {videoSubmitError && <div className="field-error" style={{ marginTop: 10 }}>{videoSubmitError}</div>}
        </Card>
      )}

      {answered && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button onClick={handleNext}>
            {currentQuestion._result.sessionComplete ? 'Finish Interview' : 'Next Question'}
          </Button>
        </div>
      )}
    </div>
  )
}

function SpeechStatusBanner({ capabilities }) {
  let text = null
  let tone = 'info'
  if (!capabilities.reachable) {
    text = 'The AI service could not be reached, so a voice answer cannot be processed right now. Start it (see the setup guide) or switch to text mode.'
    tone = 'warn'
  } else if (capabilities.reason === 'ai_service_auth') {
    text = 'The backend and AI service use different AI_SERVICE_API_KEY values - voice answers will fail until both .env files match.'
    tone = 'warn'
  } else if (capabilities.speech) {
    const st = capabilities.speech.state
    if (st === 'loading' || st === 'not_loaded') text = 'The speech model is starting up (the first start can take a minute). You can record now; if processing says it is still loading, wait a moment and try again.'
    else if (st === 'error') { text = capabilities.speech.message || 'The speech model could not be loaded. Voice answers will not work until this is fixed (see the AI service window).'; tone = 'warn' }
  }
  if (!text) return null
  return (
    <p role={tone === 'warn' ? 'alert' : 'status'} style={{ margin: '0 0 12px', padding: '8px 12px', border: '1px solid var(--border-400)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-300)' }}>
      {text}
    </p>
  )
}
