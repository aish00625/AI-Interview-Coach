// Phase M: AI-service client - structured error forwarding, nullable speech fields, timeouts, capabilities.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { root } = require('../phaseA/helpers')
const client = require(path.join(root, 'services/aiServiceClient.js'))
const errorHandler = require(path.join(root, 'middleware/errorHandler.js'))

const evalFields = { technicalScore: 70, relevanceScore: 60, clarityScore: 80, completenessScore: 50, strengths: ['a'], weaknesses: ['b'], suggestedImprovement: 'c', modelAnswer: 'd' }
const metrics = { durationSeconds: 3.2, wordCount: 6, speakingRateWpm: null, fillerWordCount: 0, fillerWords: {}, pauseCount: null, averagePauseSeconds: null }
const speechOk = { ...evalFields, transcript: 'short answer here', speechMetrics: metrics }
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const args = { audioBuffer: Buffer.from('abc'), audioMimeType: 'audio/webm', questionText: 'q' }

async function withFetch(impl, fn) {
  const real = global.fetch; const env = { url: process.env.AI_SERVICE_URL, t: process.env.AI_SERVICE_SPEECH_TIMEOUT_MS }
  process.env.AI_SERVICE_URL = 'http://ai.test'
  global.fetch = impl
  try { return await fn() } finally {
    global.fetch = real
    if (env.url === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = env.url
    if (env.t === undefined) delete process.env.AI_SERVICE_SPEECH_TIMEOUT_MS; else process.env.AI_SERVICE_SPEECH_TIMEOUT_MS = env.t
  }
}
const rejectsWith = (p, status, reason) => assert.rejects(p, (e) => { assert.equal(e.statusCode, status); assert.equal(e.reason, reason); return true })

test('REGRESSION: a short voice answer (speakingRateWpm = null) is accepted - it used to become a 503', async () => {
  const r = await withFetch(async () => reply(200, speechOk), () => client.evaluateSpeechAnswer(args))
  assert.equal(r.transcript, 'short answer here')
  assert.equal(r.speechMetrics.speakingRateWpm, null)
})

test('speech metrics v2 extra fields are accepted; genuinely malformed metrics are still rejected', async () => {
  const v2 = { ...speechOk, speechMetrics: { ...metrics, speakingRateWpm: 130, schemaVersion: 2, articulationRateWpm: 150, reliable: true, unreliableReasons: [] } }
  await withFetch(async () => reply(200, v2), () => client.evaluateSpeechAnswer(args))
  const bad = { ...speechOk, speechMetrics: { ...metrics, wordCount: -1 } }
  await withFetch(async () => reply(200, bad), () => rejectsWith(client.evaluateSpeechAnswer(args), 503, 'ai_invalid_response'))
  await withFetch(async () => reply(200, { ...speechOk, transcript: 5 }), () => rejectsWith(client.evaluateSpeechAnswer(args), 503, 'ai_invalid_response'))
})

test('Python 503 reasons (model loading / package missing) are forwarded with message and retryable', async () => {
  const body = { detail: { reason: 'speech_model_loading', message: 'The speech model is still loading.', retryable: true } }
  await withFetch(async () => reply(503, body), () => assert.rejects(client.evaluateSpeechAnswer(args), (e) => {
    assert.deepEqual([e.statusCode, e.reason, e.retryable, e.message], [503, 'speech_model_loading', true, 'The speech model is still loading.']); return true
  }))
  const missing = { detail: { reason: 'speech_package_missing', message: 'Install requirements-speech.txt', retryable: false } }
  await withFetch(async () => reply(503, missing), () => assert.rejects(client.evaluateSpeechAnswer(args), (e) => { assert.equal(e.retryable, false); assert.equal(e.reason, 'speech_package_missing'); return true }))
})

test('Python 422 recording problems are forwarded as 422 with their reason', async () => {
  const body = { detail: { reason: 'no_speech_detected', message: 'No speech was detected.' } }
  await withFetch(async () => reply(422, body), () => assert.rejects(client.evaluateSpeechAnswer(args), (e) => {
    assert.deepEqual([e.statusCode, e.reason, e.retryable], [422, 'no_speech_detected', false]); return true
  }))
})

test('401 from the AI service becomes a clear configuration error, not a leaked 401', async () => {
  await withFetch(async () => reply(401, { detail: 'bad key' }), () => assert.rejects(client.evaluateSpeechAnswer(args), (e) => {
    assert.equal(e.statusCode, 503); assert.equal(e.reason, 'ai_service_auth'); assert.match(e.message, /AI_SERVICE_API_KEY/); return true
  }))
})

test('unknown 500 bodies (stack traces) never reach the client; reasons are shape-checked', async () => {
  await withFetch(async () => reply(500, { detail: 'Traceback (most recent call last): C:\\secret' }), () => assert.rejects(client.evaluateAnswer({ questionText: 'q', answerText: 'a' }), (e) => {
    assert.equal(e.statusCode, 503); assert.ok(!/Traceback|secret/.test(e.message)); return true
  }))
  const evil = { detail: { reason: '<script>', message: 'x' } }
  await withFetch(async () => reply(503, evil), () => assert.rejects(client.evaluateSpeechAnswer(args), (e) => { assert.equal(e.reason, 'ai_service_unavailable'); return true }))
})

test('plain-string vision details for 413/415/400 map to the right status', async () => {
  for (const [status, reason] of [[413, 'upload_too_large'], [415, 'unsupported_media'], [400, 'bad_recording']]) {
    await withFetch(async () => reply(status, { detail: 'Unsupported video type' }), () => rejectsWith(client.analyzeVideoAnswer({ videoBuffer: Buffer.from('v'), videoMimeType: 'video/webm' }), status, reason))
  }
})

test('unreachable and timeout are distinguished and marked retryable', async () => {
  await withFetch(async () => { throw new TypeError('fetch failed') }, () => assert.rejects(client.evaluateSpeechAnswer(args), (e) => {
    assert.deepEqual([e.statusCode, e.reason, e.retryable], [503, 'ai_service_unreachable', true]); return true
  }))
  process.env.AI_SERVICE_SPEECH_TIMEOUT_MS = '1000'
  await withFetch((url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), async () => {
    process.env.AI_SERVICE_SPEECH_TIMEOUT_MS = '1000'
    await rejectsWith(client.evaluateSpeechAnswer(args), 503, 'ai_service_timeout')
  })
})

test('AI_SERVICE_URL missing is reported as a configuration problem', async () => {
  const saved = process.env.AI_SERVICE_URL; delete process.env.AI_SERVICE_URL
  try { await rejectsWith(client.evaluateSpeechAnswer(args), 503, 'ai_service_not_configured') } finally { if (saved !== undefined) process.env.AI_SERVICE_URL = saved }
})

test('the media timeout defaults to 120 s and is configurable', async () => {
  const seen = []
  const realSet = global.setTimeout
  global.setTimeout = (fn, ms, ...r) => { seen.push(ms); return realSet(fn, ms, ...r) }
  try {
    delete process.env.AI_SERVICE_SPEECH_TIMEOUT_MS
    await withFetch(async () => reply(200, speechOk), () => client.evaluateSpeechAnswer(args))
    process.env.AI_SERVICE_SPEECH_TIMEOUT_MS = '45000'
    await withFetch(async () => reply(200, speechOk), async () => { process.env.AI_SERVICE_SPEECH_TIMEOUT_MS = '45000'; await client.evaluateSpeechAnswer(args) })
  } finally { global.setTimeout = realSet }
  assert.ok(seen.includes(120000), seen.join()); assert.ok(seen.includes(45000), seen.join())
})

test('getCapabilities: never throws, sanitises, and reports an unreachable service', async () => {
  const caps = { speech: { state: 'ready', errorCode: null, message: null, extra: 'x' }, vision: { state: 'face_presence_only', message: 'm' } }
  const ok = await withFetch(async () => reply(200, caps), () => client.getCapabilities())
  assert.deepEqual([ok.reachable, ok.speech.state, ok.vision.state], [true, 'ready', 'face_presence_only']); assert.equal(ok.speech.extra, undefined)
  const down = await withFetch(async () => { throw new TypeError('x') }, () => client.getCapabilities())
  assert.deepEqual([down.reachable, down.reason], [false, 'ai_service_unreachable'])
  const old = await withFetch(async () => reply(404, {}), () => client.getCapabilities())
  assert.deepEqual([old.reachable, old.reason], [true, 'capabilities_unsupported'])
})

test('errorHandler returns reason + retryable for AI errors and nothing extra for other errors', () => {
  const res = () => ({ code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } })
  const origErr = console.error; console.error = () => {}
  try {
    const a = res(); const e = Object.assign(new Error('Loading'), { statusCode: 503, reason: 'speech_model_loading', retryable: true })
    errorHandler(e, {}, a, () => {})
    assert.deepEqual(a.body, { success: false, message: 'Loading', reason: 'speech_model_loading', retryable: true })
    const b = res(); errorHandler(Object.assign(new Error('plain'), { statusCode: 409 }), {}, b, () => {})
    assert.deepEqual(b.body, { success: false, message: 'plain' })
  } finally { console.error = origErr }
})
