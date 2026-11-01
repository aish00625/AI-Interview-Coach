// localAiClient against a fake AI service (real HTTP on localhost, real aiServiceClient transport code).
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')

let mode = { status: 200, body: {}, delay: 0, raw: null }
let lastReq = null
const server = http.createServer((req, res) => {
  let data = ''
  req.on('data', (c) => { data += c })
  req.on('end', () => {
    lastReq = { method: req.method, url: req.url, key: req.headers['x-ai-service-key'], body: data ? JSON.parse(data) : null }
    setTimeout(() => {
      res.writeHead(mode.status, { 'Content-Type': 'application/json' })
      res.end(mode.raw !== null ? mode.raw : JSON.stringify(mode.body))
    }, mode.delay)
  })
})
let client
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${server.address().port}`
  process.env.AI_SERVICE_API_KEY = 'shared-key'
  client = require('../../services/localAiClient')
})
test.after(() => server.close())
const set = (m) => { mode = { status: 200, body: {}, delay: 0, raw: null, ...m } }
const fails = async (p, reason) => { await assert.rejects(p, (e) => { assert.equal(e.statusCode, 503); if (reason) assert.equal(e.reason, reason); assert.ok(e.message); return true }) }

test('status: every state is reported; unknown shapes become "unknown"; never throws', async () => {
  set({ body: { state: 'ready', model: 'qwen3:4b', installedModels: ['qwen3:4b'] } })
  const s = await client.getStatus()
  assert.equal(s.state, 'ready'); assert.equal(s.model, 'qwen3:4b'); assert.equal(lastReq.key, 'shared-key'); assert.equal(lastReq.url, '/llm/status')
  set({ body: { state: 'model_missing', model: 'qwen3:4b', message: 'Run: ollama pull qwen3:4b' } })
  assert.equal((await client.getStatus()).state, 'model_missing')
  set({ body: { state: 'weird' } }); assert.equal((await client.getStatus()).state, 'unknown')
  set({ status: 404, body: {} }); assert.equal((await client.getStatus()).reason, 'ai_service_outdated')
  set({ status: 401, body: {} }); assert.equal((await client.getStatus()).reason, 'ai_service_auth')
  set({ status: 500, body: {} }); assert.equal((await client.getStatus()).state, 'unknown')
})

test('status: AI service down or not configured is "unknown", not an exception', async () => {
  const url = process.env.AI_SERVICE_URL
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9'
  assert.equal((await client.getStatus()).reason, 'ai_service_unreachable')
  delete process.env.AI_SERVICE_URL
  assert.equal((await client.getStatus()).reason, 'ai_service_not_configured')
  process.env.AI_SERVICE_URL = url
})

test('follow-up: request body shape, validated response, malformed responses rejected', async () => {
  set({ body: { followUp: 'How would you test that?', reason: 'probe', model: 'qwen3:4b' } })
  const out = await client.followUp({ question: 'Q', answer: 'A', interviewType: 'technical', difficulty: 'easy', targetRole: 'Dev', missingCriteria: ['x'], previousTurns: [] })
  assert.deepEqual(out, { prompt: 'How would you test that?', reason: 'probe', model: 'qwen3:4b' })
  assert.equal(lastReq.url, '/llm/follow-up'); assert.equal(lastReq.body.interview_type, 'technical'); assert.deepEqual(lastReq.body.missing_criteria, ['x'])
  for (const body of [{ followUp: 'no question mark' }, { followUp: 42 }, {}]) {
    set({ body }); await fails(client.followUp({ question: 'Q', answer: 'A' }), 'llm_bad_response')
  }
})

test('Python-side failures are forwarded with a stable reason and a user message; stack traces are not', async () => {
  set({ status: 503, body: { detail: { reason: 'llm_unreachable', message: 'The local AI model (Ollama) is not running.', retryable: true } } })
  await assert.rejects(client.star({ question: 'Q', answer: 'A' }), (e) => { assert.equal(e.reason, 'llm_unreachable'); assert.match(e.message, /Ollama/); assert.equal(e.retryable, true); return true })
  set({ status: 502, body: { detail: { reason: 'llm_bad_response', message: 'Did not return structured feedback.', retryable: true } } })
  await fails(client.report({ interviewType: 'technical', difficulty: 'easy', finalScore: 1, items: [] }), 'llm_bad_response')
  set({ status: 500, body: { detail: 'Traceback (most recent call last): secret path /srv/app' } })
  await assert.rejects(client.followUpFeedback({ prompt: 'P', answer: 'A' }), (e) => { assert.equal(e.reason, 'llm_error'); assert.ok(!/Traceback|secret/.test(e.message)); return true })
  set({ status: 401, body: {} })
  await fails(client.codeCoach({ title: 't', statement: 's', language: 'python', code: 'c', status: 'ok', tests: [] }), 'ai_service_auth')
  set({ raw: '<html>not json</html>' })
  await fails(client.star({ question: 'Q', answer: 'A' }))
})

test('timeout: a model that takes too long becomes a retryable 503', async () => {
  const old = process.env.AI_SERVICE_LLM_TIMEOUT_MS
  // the configured minimum is 5 s, so shorten via the env value and a slower server
  process.env.AI_SERVICE_LLM_TIMEOUT_MS = '5000'
  set({ delay: 5600, body: { followUp: 'Why?', model: 'm' } })
  await assert.rejects(client.followUp({ question: 'Q', answer: 'A' }), (e) => { assert.equal(e.reason, 'ai_service_timeout'); assert.equal(e.retryable, true); return true })
  if (old === undefined) delete process.env.AI_SERVICE_LLM_TIMEOUT_MS; else process.env.AI_SERVICE_LLM_TIMEOUT_MS = old
})

test('STAR: all four elements and valid statuses are required; sizes are capped', async () => {
  const el = (status) => ({ status, evidence: 'e'.repeat(500), suggestion: 's'.repeat(900) })
  set({ body: { elements: { situation: el('present'), task: el('weak'), action: el('present'), result: el('missing') }, overall: 'o', evidenceDropped: 2, model: 'm' } })
  const ok = await client.star({ question: 'Q', answer: 'A' })
  assert.equal(ok.elements.situation.evidence.length, 220); assert.equal(ok.elements.task.suggestion.length, 300); assert.equal(ok.evidenceDropped, 2)
  set({ body: { elements: { situation: el('present') } } }); await fails(client.star({ question: 'Q', answer: 'A' }), 'llm_bad_response')
  set({ body: { elements: { situation: el('great'), task: el('weak'), action: el('present'), result: el('missing') } } }); await fails(client.star({ question: 'Q', answer: 'A' }), 'llm_bad_response')
})

test('code coach: no pass/fail field survives, lists are capped, empty coaching is rejected', async () => {
  set({ body: { summary: 'S', hints: ['1', '2', '3', '4', '5'], edgeCases: [1, 'a'], complexity: { time: 'O(n)', space: null }, passed: true, status: 'passed', model: 'm' } })
  const r = await client.codeCoach({ title: 't', statement: 's', language: 'python', code: 'c', status: 'wrong_answer', tests: [] })
  assert.equal(r.hints.length, 3); assert.deepEqual(r.edgeCases, ['a']); assert.ok(!('passed' in r) && !('status' in r)); assert.match(r.complexity.note, /not measured/)
  set({ body: { hints: [], summary: '' } }); await fails(client.codeCoach({ title: 't', statement: 's', language: 'python', code: 'c', status: 'x', tests: [] }), 'llm_bad_response')
})
