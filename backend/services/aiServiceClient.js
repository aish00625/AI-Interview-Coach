/**
 * HTTP client for the Python FastAPI AI service, per the Phase 1
 * architecture: Node → Python, never React → Python directly, and
 * Python never touches PostgreSQL — it only receives text and returns a
 * JSON evaluation.
 *
 * Uses Node's built-in `fetch` (global since Node 18) rather than adding
 * a new HTTP dependency to the backend.
 */

const { sanitizeCameraSignals } = require('../utils/cameraSignals')
const AI_SERVICE_TIMEOUT_MS = 10000
const AI_CAPABILITIES_TIMEOUT_MS = 3000

/**
 * Speech transcription and video analysis are CPU-heavy, and the very first request after the AI service starts can
 * also have to load (or download) the Whisper model. 30 s was too short for that and surfaced as a 503, so the budget
 * is now configurable and defaults to 120 s. Read at call time so tests / .env changes apply without a re-require.
 */
function mediaTimeoutMs() {
  const n = Number(process.env.AI_SERVICE_SPEECH_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, 600000) : 120000
}

/**
 * Error thrown for every AI-service failure. `statusCode` is what the browser gets; `reason` is a stable
 * machine-readable code the frontend uses to show a specific, actionable message; `retryable` says whether trying
 * again later can help. Only these three fields and a short message ever leave the backend - never the Python body.
 */
function aiError(statusCode, reason, message, retryable = false) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.reason = reason
  err.retryable = retryable
  return err
}

function serviceUnavailableError(message = 'AI evaluation service is temporarily unavailable.', reason = 'ai_service_unavailable', retryable = true) {
  return aiError(503, reason, message, retryable)
}

const SAFE_REASON = /^[a-z][a-z0-9_]{2,60}$/

/**
 * Turns a non-2xx response from the AI service into a controlled error. Python's structured `detail`
 * ({reason, message, retryable}) is forwarded (those messages are written for end users); anything else collapses
 * to a generic 503 so stack traces or internal text never reach the client.
 */
function errorFromResponse(status, body, fallbackMessage) {
  const detail = body && typeof body === 'object' ? body.detail : null
  const structured = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null
  const reason = structured && typeof structured.reason === 'string' && SAFE_REASON.test(structured.reason) ? structured.reason : null
  const message = structured && typeof structured.message === 'string' && structured.message.trim() ? structured.message.slice(0, 400) : null

  if (status === 422) return aiError(422, reason || 'recording_unusable', message || 'The recording could not be analysed.', false)
  if (status === 413) return aiError(413, reason || 'upload_too_large', message || 'The recording is too large.', false)
  if (status === 415) return aiError(415, reason || 'unsupported_media', message || 'This recording format is not supported.', false)
  if (status === 400) return aiError(400, reason || 'bad_recording', message || 'The recording was empty or invalid.', false)
  if (status === 401) {
    return aiError(503, 'ai_service_auth', 'The backend and the AI service are configured with different API keys (AI_SERVICE_API_KEY). Check both .env files.', false)
  }
  if (status === 503) {
    return aiError(503, reason || 'ai_service_unavailable', message || fallbackMessage, structured ? structured.retryable !== false : true)
  }
  return aiError(503, reason || 'ai_service_error', fallbackMessage, true)
}

/** fetch() wrapper: distinguishes timeout / unreachable and returns { response, body }. */
async function callAi(url, init, timeoutMs, unavailableMessage) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw aiError(503, 'ai_service_timeout', `${unavailableMessage} The AI service took too long to respond - on the first request it may still be loading its models. Please try again.`, true)
    }
    throw aiError(503, 'ai_service_unreachable', `${unavailableMessage} The AI service could not be reached - check that it is running and that AI_SERVICE_URL is correct.`, true)
  } finally {
    clearTimeout(timeout)
  }
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { response, body }
}

function notConfigured() {
  return aiError(503, 'ai_service_not_configured', 'AI_SERVICE_URL is not set in the backend .env file.', false)
}

/** The 8 fields common to both POST /evaluate and POST /speech-evaluate's response (the latter is a superset). */
function hasValidEvaluationFields(data) {
  if (!data || typeof data !== 'object') return false
  const numericFields = ['technicalScore', 'relevanceScore', 'clarityScore', 'completenessScore']
  const arrayFields = ['strengths', 'weaknesses']
  const stringFields = ['suggestedImprovement', 'modelAnswer']

  const numbersOk = numericFields.every(
    (f) => typeof data[f] === 'number' && Number.isFinite(data[f]) && data[f] >= 0 && data[f] <= 100,
  )
  const arraysOk = arrayFields.every((f) => Array.isArray(data[f]) && data[f].every((item) => typeof item === 'string'))
  const stringsOk = stringFields.every((f) => typeof data[f] === 'string')

  return numbersOk && arraysOk && stringsOk
}

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low'])

const { ANSWER_QUALITY_LABELS } = require('../utils/answerQuality')

/** Whitelists and bounds `answerQuality`. Anything unexpected becomes null (older AI services do not send it), never a guess. */
function sanitizeAnswerQuality(q) {
  if (!q || typeof q !== 'object' || !Object.prototype.hasOwnProperty.call(ANSWER_QUALITY_LABELS, q.status)) return null
  const count = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 100000) : null)
  const ratio = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 1000) / 1000)) : null)
  return {
    status: q.status,
    label: ANSWER_QUALITY_LABELS[q.status],
    evaluable: q.status !== 'not_evaluable',
    reasons: Array.isArray(q.reasons) ? q.reasons.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.slice(0, 400)).slice(0, 5) : [],
    wordCount: count(q.wordCount),
    meaningfulWordCount: count(q.meaningfulWordCount),
    wordLikeRatio: ratio(q.wordLikeRatio),
    scoreBasis: typeof q.scoreBasis === 'string' ? q.scoreBasis.slice(0, 120) : null,
  }
}

/**
 * Optional honesty metadata added to /evaluate and /speech-evaluate in Phase H (confidence, rubric id/kind, matched and
 * missing criteria). Strictly optional and defensively sanitised: an older AI service that doesn't send these fields
 * yields null, and malformed values are dropped rather than rejecting an otherwise valid evaluation.
 */
function extractEvaluationMeta(data) {
  if (!data || typeof data !== 'object' || !VALID_CONFIDENCE.has(data.confidence)) return null
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 20) : [])
  return {
    confidence: data.confidence,
    confidenceNote: typeof data.confidenceNote === 'string' ? data.confidenceNote.slice(0, 600) : null,
    rubricId: typeof data.rubricId === 'string' ? data.rubricId : null,
    rubricKind: ['concept', 'star', 'criteria'].includes(data.rubricKind) ? data.rubricKind : null,
    matchedCriteria: strList(data.matchedCriteria),
    missingCriteria: strList(data.missingCriteria),
    answerQuality: sanitizeAnswerQuality(data.answerQuality),
  }
}

/**
 * Confirms the Python response actually has the shape interviewService
 * and interview_answers expect, before any of it is trusted. A response
 * that's missing a field, or has the wrong type, is treated exactly like
 * a service failure — we never store a partially-valid "evaluation".
 */
function isValidEvaluation(data) {
  return hasValidEvaluationFields(data)
}

/**
 * Same as isValidEvaluation, plus a transcript string and the
 * speechMetrics object. pauseCount/averagePauseSeconds inside
 * speechMetrics may legitimately be null (pause detection isn't always
 * available — see ai-service/app/services/speech_processor.py) so those
 * two are checked as "number or null", never required to be a number.
 */
function isValidSpeechEvaluation(data) {
  if (!hasValidEvaluationFields(data)) return false
  if (typeof data.transcript !== 'string') return false

  const m = data.speechMetrics
  if (!m || typeof m !== 'object') return false
  const numOrNull = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)
  if (typeof m.durationSeconds !== 'number' || !Number.isFinite(m.durationSeconds) || m.durationSeconds < 0) return false
  if (!Number.isInteger(m.wordCount) || m.wordCount < 0) return false
  // speakingRateWpm is legitimately null for very short answers (the AI service refuses to invent a rate from a few
  // words). Requiring a number here made every short voice answer fail with a 503.
  if (!numOrNull(m.speakingRateWpm)) return false
  if (!Number.isInteger(m.fillerWordCount) || m.fillerWordCount < 0) return false
  if (!m.fillerWords || typeof m.fillerWords !== 'object') return false
  if (m.pauseCount !== null && m.pauseCount !== undefined && !Number.isInteger(m.pauseCount)) return false
  if (!numOrNull(m.averagePauseSeconds)) return false
  return true
}

/**
 * Sends one question/answer pair to Python's POST /evaluate and returns
 * its evaluation. Never fabricates a result: any failure — the service
 * being down, a timeout, an HTTP error, or a malformed response — throws
 * a controlled 503 rather than returning fake scores.
 *
 * @param {{ questionText: string, answerText: string, targetRole?: string, difficulty?: string, interviewType?: string }} params
 */
async function evaluateAnswer({ questionText, answerText, targetRole, difficulty, interviewType }) {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) throw notConfigured()

  const { response, body: data } = await callAi(`${baseUrl}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' },
    body: JSON.stringify({
      question: questionText,
      answer: answerText,
      target_role: targetRole ?? null,
      difficulty: difficulty ?? null,
      interview_type: interviewType ?? null,
    }),
  }, AI_SERVICE_TIMEOUT_MS, 'AI evaluation is unavailable.')

  if (!response.ok) throw errorFromResponse(response.status, data, 'AI evaluation service is temporarily unavailable.')
  if (!isValidEvaluation(data)) throw serviceUnavailableError('AI evaluation service returned an invalid response.', 'ai_invalid_response', false)

  return { ...data, evaluationMeta: extractEvaluationMeta(data) }
}

const VALID_VISION_STATUSES = new Set(['complete', 'model_unavailable'])

/**
 * Confirms the vision response has the shape interview_answers.cv_metrics
 * expects. Unlike the score-based validators above, most fields here are
 * legitimately nullable (facePresent, facePresenceRatio, framesWithGaze,
 * framesWithHeadPose, lookingAwayRatio, averageGazeDeviation, headPose) —
 * that's how Python honestly reports "the landmark model isn't available"
 * or "no frame produced a usable reading," so null is only rejected where
 * it can never legitimately occur (analysisStatus, the two frame counts).
 */
function isValidVisionAnalysis(data) {
  if (!data || typeof data !== 'object') return false
  if (typeof data.analysisStatus !== 'string' || !VALID_VISION_STATUSES.has(data.analysisStatus)) return false
  if (!Number.isInteger(data.framesAnalyzed) || data.framesAnalyzed < 0) return false
  if (!Number.isInteger(data.framesWithFace) || data.framesWithFace < 0) return false

  const numOrNull = (v) => v === null || typeof v === 'number'
  const intOrNull = (v) => v === null || Number.isInteger(v)
  if (data.facePresent !== null && typeof data.facePresent !== 'boolean') return false
  if (!numOrNull(data.facePresenceRatio)) return false
  if (!intOrNull(data.framesWithGaze)) return false
  if (!intOrNull(data.framesWithHeadPose)) return false
  if (!numOrNull(data.lookingAwayRatio)) return false
  if (!numOrNull(data.averageGazeDeviation)) return false
  if (data.headPose !== null) {
    if (typeof data.headPose !== 'object') return false
    if (!['yaw', 'pitch', 'roll'].every((k) => typeof data.headPose[k] === 'number')) return false
  }

  return true
}

async function generateQuestions(/* { targetRole, difficulty, skills, weakTopics } */) {
  throw new Error('aiServiceClient.generateQuestions() is not implemented — question generation is still the Phase 6 local question bank.')
}

async function analyzeCode(/* { sourceCode, language } */) {
  throw new Error('aiServiceClient.analyzeCode() is implemented in a later phase.')
}

/**
 * Sends one audio answer (as multipart/form-data — a real file upload,
 * not JSON) to Python's POST /speech-evaluate and returns its
 * transcript + evaluation + speech metrics. Same failure philosophy as
 * evaluateAnswer: any failure throws a controlled 503, never a fake
 * transcript or fabricated scores.
 *
 * Uses Node's built-in FormData/Blob (global since Node 18, via undici)
 * — fetch sets the multipart Content-Type/boundary header itself when
 * the body is a FormData instance; it must NOT be set manually.
 *
 * @param {{ audioBuffer: Buffer, audioMimeType: string, questionText: string, targetRole?: string, difficulty?: string, interviewType?: string }} params
 */
async function evaluateSpeechAnswer({ audioBuffer, audioMimeType, questionText, targetRole, difficulty, interviewType }) {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) throw notConfigured()

  const form = new FormData()
  form.append('audio', new Blob([audioBuffer], { type: audioMimeType || 'application/octet-stream' }), 'answer')
  form.append('question', questionText)
  if (targetRole) form.append('target_role', targetRole)
  if (difficulty) form.append('difficulty', difficulty)
  if (interviewType) form.append('interview_type', interviewType)

  // No Content-Type header: fetch sets "multipart/form-data; boundary=..." itself for a FormData body.
  const { response, body: data } = await callAi(`${baseUrl}/speech-evaluate`, {
    method: 'POST',
    headers: { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' },
    body: form,
  }, mediaTimeoutMs(), 'Speech processing is unavailable.')

  if (!response.ok) throw errorFromResponse(response.status, data, 'Speech processing is currently unavailable. Please try again or switch to text mode.')
  if (!isValidSpeechEvaluation(data)) throw serviceUnavailableError('Speech processing service returned an invalid response.', 'ai_invalid_response', false)

  return { ...data, evaluationMeta: extractEvaluationMeta(data) }
}

/**
 * Sends one recorded video clip (as multipart/form-data) to Python's
 * POST /vision-evaluate and returns its structured visual metrics. Same
 * failure philosophy as evaluateAnswer/evaluateSpeechAnswer: any
 * failure — service down, timeout, HTTP error, or a malformed response —
 * throws a controlled 503/422 rather than fabricating a result.
 *
 * A 422 from Python (video rejected — unreadable, too long, too large a
 * frame) is forwarded as a 422 with Python's safe reason/message, since
 * that's the caller's own input being unusable, not a service failure.
 * Every other failure mode collapses to 503, same as the other clients.
 *
 * @param {{ videoBuffer: Buffer, videoMimeType: string }} params
 */
async function analyzeVideoAnswer({ videoBuffer, videoMimeType, keepSnapshots = true }) {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) throw notConfigured()

  const form = new FormData()
  form.append('video', new Blob([videoBuffer], { type: videoMimeType || 'application/octet-stream' }), 'answer')

  const { response, body: data } = await callAi(`${baseUrl}/vision-evaluate`, {
    method: 'POST',
    headers: { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' },
    body: form,
  }, mediaTimeoutMs(), 'Visual analysis is unavailable.')

  if (!response.ok) {
    // Vision uses plain-string `detail` for 413/415/400 and a structured one for 422/503.
    throw errorFromResponse(response.status, data, 'Visual analysis is currently unavailable. Please try again.')
  }
  if (!isValidVisionAnalysis(data)) throw serviceUnavailableError('Visual analysis service returned an invalid response.', 'ai_invalid_response', false)

  // The derived signals are display-only extras: they are whitelisted and bounded, and an odd value becomes null instead of failing the answer.
  return { ...data, ...sanitizeCameraSignals(data, { keepSnapshots }) }
}

/**
 * Asks the AI service what it can currently do (speech model state, camera analysis level). Never throws: when the
 * service cannot be reached the answer is `{ reachable: false }`, so the UI can warn instead of failing.
 */
async function getCapabilities() {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) return { reachable: false, reason: 'ai_service_not_configured' }
  try {
    const { response, body } = await callAi(`${baseUrl}/capabilities`, {
      method: 'GET',
      headers: { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' },
    }, AI_CAPABILITIES_TIMEOUT_MS, 'Capabilities unavailable.')
    if (response.status === 401) return { reachable: true, reason: 'ai_service_auth' }
    if (!response.ok || !body || typeof body !== 'object') return { reachable: true, reason: 'capabilities_unsupported' }
    const speech = body.speech && typeof body.speech === 'object' ? body.speech : {}
    const vision = body.vision && typeof body.vision === 'object' ? body.vision : {}
    return {
      reachable: true,
      speech: {
        state: ['not_loaded', 'loading', 'ready', 'error'].includes(speech.state) ? speech.state : 'unknown',
        errorCode: typeof speech.errorCode === 'string' ? speech.errorCode.slice(0, 60) : null,
        message: typeof speech.message === 'string' ? speech.message.slice(0, 300) : null,
      },
      vision: {
        state: ['complete', 'face_presence_only', 'unavailable'].includes(vision.state) ? vision.state : 'unknown',
        message: typeof vision.message === 'string' ? vision.message.slice(0, 300) : null,
      },
    }
  } catch (err) {
    return { reachable: false, reason: err.reason || 'ai_service_unreachable' }
  }
}


/* ---------------------------------------------------------------------------------------------------------------
 * Face monitoring (per-frame). One small image per call, processed in memory by the AI service and discarded.
 * ------------------------------------------------------------------------------------------------------------- */
function faceTimeoutMs() {
  const n = Number(process.env.AI_SERVICE_FACE_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 60000) : 8000
}

const aiHeaders = () => ({ 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' })

async function analyzeFaceFrame({ frameBuffer, mimeType, referenceKey }) {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) throw notConfigured()
  const form = new FormData()
  form.append('frame', new Blob([frameBuffer], { type: mimeType || 'image/jpeg' }), 'frame')
  if (referenceKey) form.append('reference_key', referenceKey)
  const { response, body } = await callAi(`${baseUrl}/face-frame`, { method: 'POST', headers: aiHeaders(), body: form }, faceTimeoutMs(), 'Face analysis is unavailable.')
  if (!response.ok) throw errorFromResponse(response.status, body, 'Face analysis is currently unavailable.')
  return body
}

async function storeFaceReference({ frameBuffer, mimeType, referenceKey }) {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) throw notConfigured()
  const form = new FormData()
  form.append('frame', new Blob([frameBuffer], { type: mimeType || 'image/jpeg' }), 'frame')
  form.append('reference_key', referenceKey)
  const { response, body } = await callAi(`${baseUrl}/face-reference`, { method: 'POST', headers: aiHeaders(), body: form }, faceTimeoutMs(), 'Face analysis is unavailable.')
  if (!response.ok) throw errorFromResponse(response.status, body, 'Face analysis is currently unavailable.')
  return body
}

/** Best effort: the reference also expires on its own in the AI service, so a failure here is not an error. */
async function deleteFaceReference(referenceKey) {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl || !referenceKey) return false
  try {
    const { response, body } = await callAi(`${baseUrl}/face-reference/${encodeURIComponent(referenceKey)}`, { method: 'DELETE', headers: aiHeaders() }, 3000, 'Face analysis is unavailable.')
    return !!(response.ok && body && body.deleted)
  } catch {
    return false
  }
}

/** Never throws. { reachable, reason?, faceMonitor? } - faceMonitor is the AI service's own description of what it can measure. */
async function getFaceMonitorCapabilities() {
  const baseUrl = process.env.AI_SERVICE_URL
  if (!baseUrl) return { reachable: false, reason: 'ai_service_not_configured' }
  try {
    const { response, body } = await callAi(`${baseUrl}/capabilities`, { method: 'GET', headers: aiHeaders() }, AI_CAPABILITIES_TIMEOUT_MS, 'Capabilities unavailable.')
    if (response.status === 401) return { reachable: true, reason: 'ai_service_auth' }
    const fm = body && typeof body === 'object' ? body.faceMonitor : null
    if (!response.ok || !fm || typeof fm !== 'object') return { reachable: true, reason: 'face_monitor_unsupported' }
    const f = fm.features && typeof fm.features === 'object' ? fm.features : null
    return {
      reachable: true,
      faceMonitor: {
        available: fm.available === true,
        state: ['complete', 'face_presence_only', 'unavailable'].includes(fm.state) ? fm.state : 'unavailable',
        message: typeof fm.message === 'string' ? fm.message.slice(0, 300) : null,
        features: f ? Object.fromEntries(['faceDetection', 'multipleFaces', 'imageQuality', 'headPose', 'gaze', 'identity'].map((k) => [k, f[k] === true])) : null,
      },
    }
  } catch (err) {
    return { reachable: false, reason: err && err.reason ? err.reason : 'ai_service_unreachable' }
  }
}

module.exports = {
  analyzeFaceFrame, storeFaceReference, deleteFaceReference, getFaceMonitorCapabilities,
  extractEvaluationMeta, sanitizeAnswerQuality, ANSWER_QUALITY_LABELS, evaluateAnswer, generateQuestions, analyzeCode, evaluateSpeechAnswer, analyzeVideoAnswer, getCapabilities,
  isValidSpeechEvaluation, isValidVisionAnalysis, errorFromResponse, callAi, aiError,
}
