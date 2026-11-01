/**
 * Client for the AI service's /llm/* routes (the local Ollama model). Same transport rules as aiServiceClient: Node ->
 * Python only, shared key, never the browser.
 *
 * Contract used by every caller:
 *   - every function either returns validated data or throws an error with { statusCode, reason, message, retryable };
 *   - callers treat ANY thrown error as "the model is not available right now" and fall back to rule-based behaviour;
 *   - responses are re-validated here (types and sizes) even though Python validated them, so a bad or old AI service can
 *     never put unexpected shapes into the database or the UI.
 */
const { callAi, aiError } = require('./aiServiceClient')

const STATUS_TIMEOUT_MS = 4000
const SAFE_REASON = /^[a-z][a-z0-9_]{2,60}$/

/** Generation can be slow on a CPU-only laptop. Configurable; default 150 s (a little above the AI service's own limit). */
function llmTimeoutMs() {
  const n = Number(process.env.AI_SERVICE_LLM_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 5000 ? Math.min(n, 600000) : 150000
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null)
const strList = (v, n, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, max)) : [])

function configured() {
  if (!process.env.AI_SERVICE_URL) throw aiError(503, 'ai_service_not_configured', 'AI_SERVICE_URL is not set in the backend .env file.', false)
  return process.env.AI_SERVICE_URL
}

function failure(status, body) {
  const d = body && typeof body === 'object' && body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail) ? body.detail : null
  const reason = d && typeof d.reason === 'string' && SAFE_REASON.test(d.reason) ? d.reason : 'llm_error'
  const message = d && typeof d.message === 'string' && d.message.trim() ? d.message.slice(0, 300) : 'The local AI model is not available right now.'
  if (status === 401) return aiError(503, 'ai_service_auth', 'The backend and the AI service are configured with different API keys (AI_SERVICE_API_KEY).', false)
  return aiError(503, reason, message, d ? d.retryable !== false : true)
}

async function post(path, payload) {
  const base = configured()
  const { response, body } = await callAi(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' },
    body: JSON.stringify(payload),
  }, llmTimeoutMs(), 'The local AI model is unavailable.')
  if (!response.ok) throw failure(response.status, body)
  if (!body || typeof body !== 'object') throw aiError(503, 'llm_bad_response', 'The local AI model returned an unreadable response.', true)
  return body
}

const bad = () => aiError(503, 'llm_bad_response', 'The local AI model returned an unexpected response.', true)

/** Never throws. { state: ready|model_missing|unreachable|disabled|error|unknown, model, message?, installedModels? } */
async function getStatus() {
  const base = process.env.AI_SERVICE_URL
  if (!base) return { state: 'unknown', reason: 'ai_service_not_configured', message: 'AI_SERVICE_URL is not set in the backend .env file.' }
  try {
    const { response, body } = await callAi(`${base}/llm/status`, {
      method: 'GET', headers: { 'X-AI-Service-Key': process.env.AI_SERVICE_API_KEY || '' },
    }, STATUS_TIMEOUT_MS, 'Local AI status unavailable.')
    if (response.status === 401) return { state: 'unknown', reason: 'ai_service_auth', message: 'The backend and the AI service use different AI_SERVICE_API_KEY values.' }
    if (response.status === 404) return { state: 'unknown', reason: 'ai_service_outdated', message: 'The AI service is an older version without local-model support. Restart it after updating.' }
    if (!response.ok || !body || typeof body !== 'object') return { state: 'unknown', reason: 'ai_service_error', message: 'The AI service did not report the local model status.' }
    const ok = ['ready', 'model_missing', 'unreachable', 'disabled', 'error'].includes(body.state)
    return {
      state: ok ? body.state : 'unknown', model: str(body.model, 80), provider: 'ollama',
      message: str(body.message, 300), installedModels: strList(body.installedModels, 20, 80),
    }
  } catch (err) {
    return { state: 'unknown', reason: err.reason || 'ai_service_unreachable', message: 'The AI service could not be reached.' }
  }
}

async function followUp({ question, answer, interviewType, difficulty, targetRole, missingCriteria, previousTurns }) {
  const out = await post('/llm/follow-up', {
    question, answer, interview_type: interviewType, difficulty, target_role: targetRole || '',
    missing_criteria: (missingCriteria || []).slice(0, 10), previous_turns: (previousTurns || []).slice(0, 3),
  })
  const prompt = str(out.followUp, 300)
  if (!prompt || !prompt.includes('?')) throw bad()
  return { prompt, reason: str(out.reason, 200), model: str(out.model, 80) }
}

async function followUpFeedback({ prompt, answer, interviewType }) {
  const out = await post('/llm/follow-up-feedback', { prompt, answer, interview_type: interviewType })
  const feedback = str(out.feedback, 600)
  if (!feedback) throw bad()
  return { feedback, strength: str(out.strength, 250), improve: str(out.improve, 300), model: str(out.model, 80) }
}

const STAR_KEYS = ['situation', 'task', 'action', 'result']
async function star({ question, answer }) {
  const out = await post('/llm/star', { question, answer })
  const elements = {}
  for (const k of STAR_KEYS) {
    const e = out.elements && out.elements[k]
    if (!e || !['present', 'weak', 'missing'].includes(e.status)) throw bad()
    elements[k] = { status: e.status, evidence: str(e.evidence, 220), suggestion: str(e.suggestion, 300) || '' }
  }
  return { elements, overall: str(out.overall, 500), evidenceDropped: Number.isInteger(out.evidenceDropped) ? out.evidenceDropped : 0, model: str(out.model, 80) }
}

async function codeCoach({ title, statement, language, code, status, tests, stderr }) {
  const out = await post('/llm/code-coach', { title, statement, language, code, status, tests, stderr: stderr || '' })
  const cx = out.complexity && typeof out.complexity === 'object' ? out.complexity : {}
  const result = {
    summary: str(out.summary, 500), failureExplanation: str(out.failureExplanation, 700),
    hints: strList(out.hints, 3, 300), edgeCases: strList(out.edgeCases, 4, 200),
    complexity: { time: str(cx.time, 40), space: str(cx.space, 40), note: 'Approximate, estimated by the AI model from the code; not measured.' },
    model: str(out.model, 80),
  }
  if (!result.summary && !result.hints.length) throw bad()
  return result
}

async function report({ interviewType, targetRole, difficulty, finalScore, items }) {
  const out = await post('/llm/report', { interview_type: interviewType, target_role: targetRole || '', difficulty, final_score: finalScore, items })
  const summary = str(out.summary, 700)
  if (!summary) throw bad()
  return { summary, strengths: strList(out.strengths, 4, 250), improvements: strList(out.improvements, 4, 250), nextSteps: strList(out.nextSteps, 4, 250), model: str(out.model, 80) }
}

module.exports = { getStatus, followUp, followUpFeedback, star, codeCoach, report, llmTimeoutMs }
