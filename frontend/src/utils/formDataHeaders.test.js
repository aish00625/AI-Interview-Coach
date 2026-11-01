// Regression test for "A resume file is required (field name "resume")": drives the REAL axios with the same
// configuration as services/api.js (JSON default header + the interceptor) against a local HTTP server and checks
// what actually goes over the wire.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import axios from 'axios'
import { dropJsonHeaderForFormData } from './formDataHeaders.js'

function startServer() {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ contentType: req.headers['content-type'] || '', auth: req.headers.authorization || null, body: Buffer.concat(chunks).toString('latin1') })
      res.setHeader('Content-Type', 'application/json'); res.end('{}')
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, baseURL: `http://127.0.0.1:${server.address().port}` })))
}
const client = (baseURL, withFix) => {
  const c = axios.create({ baseURL, headers: { 'Content-Type': 'application/json' } })
  c.interceptors.request.use((config) => { config.headers.Authorization = 'Bearer test-token'; return withFix ? dropJsonHeaderForFormData(config) : config })
  return c
}
const resumeForm = () => { const f = new FormData(); f.append('resume', new Blob(['%PDF-1.4 resume body'], { type: 'application/pdf' }), 'cv.pdf'); return f }

test('FormData uploads go out as multipart with the file and field name, and keep the auth header', async () => {
  const { server, seen, baseURL } = await startServer()
  await client(baseURL, true).post('/resumes', resumeForm())
  server.close()
  const r = seen[0]
  assert.match(r.contentType, /^multipart\/form-data; boundary=/)
  assert.match(r.body, /name="resume"; filename="cv\.pdf"/)
  assert.ok(r.body.includes('%PDF-1.4 resume body'), 'file bytes are in the body')
  assert.equal(r.auth, 'Bearer test-token')
})

test('without the fix the same request is sent as JSON with no file (this is the original bug)', async () => {
  const { server, seen, baseURL } = await startServer()
  await client(baseURL, false).post('/resumes', resumeForm())
  server.close()
  assert.match(seen[0].contentType, /application\/json/)
  assert.equal(seen[0].body.includes('%PDF-1.4'), false)
})

test('normal JSON requests are unchanged', async () => {
  const { server, seen, baseURL } = await startServer()
  await client(baseURL, true).post('/auth/login', { email: 'a@b.c', password: 'x' })
  server.close()
  assert.match(seen[0].contentType, /application\/json/)
  assert.deepEqual(JSON.parse(seen[0].body), { email: 'a@b.c', password: 'x' })
})

test('api.js registers the fix on the shared client and the resume upload uses the "resume" field', () => {
  const src = fs.readFileSync(new URL('../services/api.js', import.meta.url), 'utf8')
  assert.match(src, /import \{ dropJsonHeaderForFormData \}/)
  assert.match(src, /return dropJsonHeaderForFormData\(config\)/)
  assert.match(src, /form\.append\('resume', file\)/)
})
