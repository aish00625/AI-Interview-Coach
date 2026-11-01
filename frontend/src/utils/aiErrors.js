/**
 * Maps the backend's stable AI-service error `reason` codes (see backend/services/aiServiceClient.js) to messages that
 * tell the person what actually happened and what to do. The backend only sends a short safe message, so these
 * fall back to it for any reason code this version of the app does not know.
 */
const BY_REASON = {
  speech_model_loading: { message: 'The speech model is still starting up (the first start can take a minute). Wait a moment and press "Try again".', retry: true },
  speech_model_unavailable: { message: 'The speech model could not be loaded on the AI service. Check the AI service window for the reason, or switch to text mode.', retry: true },
  speech_package_missing: { message: 'Voice answers need the speech add-on installed on the AI service (pip install -r requirements-speech.txt). You can switch to text mode meanwhile.', retry: false },
  speech_transcription_failed: { message: 'The recording could not be transcribed. Please record it again.', retry: false },
  no_speech_detected: { message: 'No speech was detected in the recording. Check that the right microphone is selected, speak a little closer, and record again.', retry: false },
  audio_too_short: { message: 'That recording was too short. Please answer in a sentence or two at least, then record again.', retry: false },
  audio_too_long: { message: 'That recording was too long. Please keep the answer shorter and record again.', retry: false },
  audio_unreadable: { message: 'The recording could not be read. Please record it again, or switch to text mode.', retry: false },
  audio_too_large: { message: 'That recording is too large. Please keep the answer shorter.', retry: false },
  upload_too_large: { message: 'That recording is too large. Please keep it shorter.', retry: false },
  unsupported_media: { message: "Your browser's recording format isn't supported. Try Chrome or Edge, or switch to text mode.", retry: false },
  ai_service_timeout: { message: 'The AI service took too long to respond. If this was the first voice answer, its model may still be loading - wait a minute and try again.', retry: true },
  ai_service_unreachable: { message: 'The AI service could not be reached. Check that it is running (see the setup guide), then try again.', retry: true },
  ai_service_not_configured: { message: 'The backend is missing AI_SERVICE_URL in its .env file.', retry: false },
  ai_service_auth: { message: 'The backend and AI service use different AI_SERVICE_API_KEY values. Make both .env files match and restart them.', retry: false },
  llm_disabled: { message: 'The local AI model is switched off (LLM_ENABLED=false). Rule-based feedback is used instead.', retry: false },
  llm_unreachable: { message: 'The local AI model (Ollama) is not running. Start it, or keep going with rule-based feedback.', retry: true },
  llm_model_missing: { message: 'The configured local model is not installed in Ollama. Run "ollama pull <model>" (see the setup guide), then try again.', retry: true },
  llm_timeout: { message: 'The local AI model took too long. A smaller model or a shorter answer helps. You can try again.', retry: true },
  llm_busy: { message: 'The local AI model is busy with another request. Try again in a moment.', retry: true },
  llm_bad_response: { message: 'The local AI model gave an unusable reply. Trying again often works.', retry: true },
  llm_error: { message: 'The local AI model could not complete this request. You can try again.', retry: true },
  vision_unavailable: { message: 'Camera analysis is not installed on the AI service. Your answer was saved without it.', retry: false },
}

/** @returns {{ message: string, retryable: boolean, reason: string|null }} */
export function describeAiError(err, fallback) {
  const data = err?.response?.data
  const reason = typeof data?.reason === 'string' ? data.reason : null
  const known = reason ? BY_REASON[reason] : null
  const retryable = known ? known.retry : data?.retryable === true
  if (known) return { message: known.message, retryable, reason }
  if (err?.code === 'ERR_NETWORK') return { message: 'Cannot reach the server. Check your connection and that the backend is running.', retryable: true, reason: 'network' }
  const status = err?.response?.status
  if (status === 409) return { message: 'This question has already been answered.', retryable: false, reason }
  const msg = data?.message
  return { message: typeof msg === 'string' && msg.length < 400 ? msg : fallback, retryable, reason }
}
