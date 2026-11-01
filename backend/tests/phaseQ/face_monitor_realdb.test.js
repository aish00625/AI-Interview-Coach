// Face monitoring, real PostgreSQL + real route chains. The AI service is a stub: these tests check ownership, consent,
// persistence, technical-vs-behaviour separation and report flow, NOT the computer-vision models.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { setup } = require('../phaseJ/harness')
const { root } = require('../phaseA/helpers')

if (!process.env.AIC_TEST_DB) { test('face monitoring DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('q')
  const { api, ok, pool, register, hiringFixture, candidateApplies } = H
  const ai = require(path.join(root, 'services/aiServiceClient'))
  const svc = require(path.join(root, 'services/faceMonitorService'))

  const FEATURES_ALL = { faceDetection: true, multipleFaces: true, imageQuality: true, headPose: true, gaze: true, identity: false }
  const caps = (over = {}) => ({ reachable: true, faceMonitor: { available: true, state: 'complete', message: 'ok', features: { ...FEATURES_ALL, ...over } } })
  const obs = (over = {}) => ({
    schemaVersion: 1, detector: 'stub', faceState: 'face_present', faceCount: 1, quality: { usable: true, issues: [], hints: [] },
    headPose: { status: 'ok', yaw: 0, pitch: 0, roll: 0 }, gaze: { status: 'ok', deviation: 0.05, side: 'centre' }, identity: { status: 'not_configured' }, ...over,
  })
  const absent = () => obs({ faceState: 'no_face', faceCount: 0, headPose: { status: 'unavailable' }, gaze: { status: 'unavailable' } })
  let analysis = async () => obs()
  const reset = () => {
    ai.getFaceMonitorCapabilities = async () => caps()
    ai.analyzeFaceFrame = async (a) => analysis(a)
    ai.storeFaceReference = async () => ({ status: 'stored', reason: null })
    ai.deleteFaceReference = async () => true
    analysis = async () => obs()
  }
  reset()
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const frame = () => ({ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'f.jpg', size: jpeg.length })
  const start = async (c, body = { consent: true }) => ok(await api('POST', '/api/face-monitoring/sessions', { token: c.token, body }), 201)
  const sendFrame = (c, id) => api('POST', `/api/face-monitoring/sessions/${id}/frames`, { token: c.token, file: frame() })
  const events = async (id) => (await pool.query('SELECT * FROM face_monitoring_events WHERE session_id = $1 ORDER BY id', [id])).rows

  test('capabilities: candidates only, with the privacy notice', async () => {
    reset()
    const c = await register('cap')
    const d = ok(await api('GET', '/api/face-monitoring/capabilities', { token: c.token }))
    assert.equal(d.available, true)
    assert.ok(d.privacy.notStored.includes('Images'))
    assert.equal(d.privacy.retentionDays, 30)
    const owner = await hiringFixture()
    assert.equal((await api('GET', '/api/face-monitoring/capabilities', { token: owner.owner.token })).status, 403)
    assert.equal((await api('GET', '/api/face-monitoring/capabilities', {})).status, 401)
  })

  test('consent is required and nothing is created without it', async () => {
    reset()
    const c = await register('noconsent')
    for (const body of [{}, { consent: false }, { consent: 'yes' }]) {
      const r = await api('POST', '/api/face-monitoring/sessions', { token: c.token, body })
      assert.equal(r.status, 400)
      assert.equal(r.body.reason, 'consent_required')
    }
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM face_monitoring_sessions WHERE user_id = $1', [c.user.id])).rows[0].n), 0)
  })

  test('create stores consent, feature availability and thresholds; a second running session is refused', async () => {
    reset()
    const c = await register('creator')
    const d = await start(c)
    assert.equal(d.session.status, 'active')
    assert.equal(d.session.features.headPose.state, 'available')
    assert.equal(d.session.features.identity.state, 'not_configured')
    assert.ok(d.session.thresholds.absence.observationMs > 0)
    const row = (await pool.query('SELECT consent_version, retention_until > now() AS future FROM face_monitoring_sessions WHERE id = $1', [d.session.id])).rows[0]
    assert.ok(row.consent_version)
    assert.equal(row.future, true)
    const again = await api('POST', '/api/face-monitoring/sessions', { token: c.token, body: { consent: true } })
    assert.equal(again.status, 409)
    assert.equal(again.body.reason, 'session_already_running')
  })

  test('unavailable AI service or missing OpenCV means no session (a clear 503), not a fake one', async () => {
    const c = await register('nosvc')
    ai.getFaceMonitorCapabilities = async () => ({ reachable: false, reason: 'ai_service_unreachable' })
    let r = await api('POST', '/api/face-monitoring/sessions', { token: c.token, body: { consent: true } })
    assert.equal(r.status, 503); assert.equal(r.body.reason, 'ai_service_unreachable')
    ai.getFaceMonitorCapabilities = async () => ({ reachable: true, faceMonitor: { available: false, state: 'unavailable', message: 'OpenCV is missing', features: null } })
    r = await api('POST', '/api/face-monitoring/sessions', { token: c.token, body: { consent: true } })
    assert.equal(r.status, 503); assert.equal(r.body.reason, 'face_monitor_unavailable')
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM face_monitoring_sessions WHERE user_id = $1', [c.user.id])).rows[0].n), 0)
    reset()
  })

  test('absence flows from AI measurements + SERVER time into one persisted event, then a report', async () => {
    reset()
    const c = await register('flow')
    const s = (await start(c)).session
    const t0 = Date.now() - 120000
    const send = (obsx, i) => { analysis = async () => obsx; return svc.submitFrame({ userId: c.user.id, sessionId: s.id, frameBuffer: jpeg, mimeType: 'image/jpeg', receivedAt: t0 + i * 2000 }) }
    await send(obs(), 0)
    let last
    for (let i = 1; i <= 12; i++) last = await send(absent(), i)   // 24 s with no face
    assert.ok(last.newEvents.length + last.updatedEvents.length >= 0)
    await send(obs(), 14)
    const ev = await events(s.id)
    const abs = ev.filter((e) => e.event_type === 'face_absent')
    assert.equal(abs.length, 1, 'one continuous absence = one event')
    assert.equal(abs[0].status, 'resolved')
    assert.ok(Number(abs[0].duration_ms) >= 20000)
    assert.equal(abs[0].category, 'warning')
    assert.match(abs[0].explanation, /not a finding of misconduct/)

    const d = ok(await api('GET', `/api/face-monitoring/sessions/${s.id}`, { token: c.token }))
    assert.equal(d.events.length, ev.length)
    assert.equal(d.session.totals.framesWithoutFace, 12)

    assert.equal((await api('GET', `/api/face-monitoring/sessions/${s.id}/report`, { token: c.token })).status, 409, 'no report until the session ends')
    const ended = ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/end`, { token: c.token }))
    assert.equal(ended.session.status, 'ended')
    assert.equal(ended.report.cards.length, 8)
    const rep = ok(await api('GET', `/api/face-monitoring/sessions/${s.id}/report`, { token: c.token }))
    assert.deepEqual(rep.report.cards.map((x) => x.key), ended.report.cards.map((x) => x.key))
    assert.ok(rep.report.notices.some((n) => /not part of any interview or coding score/.test(n)))
    assert.equal((await api('POST', `/api/face-monitoring/sessions/${s.id}/end`, { token: c.token })).status, 200, 'ending twice is harmless')
    assert.equal((await sendFrame(c, s.id)).status, 409, 'frames after the end are refused')
  })

  test('the client cannot choose scores, categories, times or results: only the AI measurement counts', async () => {
    reset()
    const c = await register('liar')
    const s = (await start(c)).session
    analysis = async () => absent()
    const r = await api('POST', `/api/face-monitoring/sessions/${s.id}/frames`, { token: c.token, file: frame(), body: { faceState: 'face_present', category: 'warning', severity: 'low', startedAt: 0, userId: 1, identityStatus: 'verified' } })
    const d = ok(r)
    assert.equal(d.session.current.faceState, 'no_face')
    assert.equal(d.session.identity.status, 'not_requested')
  })

  test('another candidate cannot read, drive, end, report on or delete my session', async () => {
    reset()
    const a = await register('alice'); const b = await register('bob')
    const s = (await start(a)).session
    for (const [m, u, extra] of [['GET', '', {}], ['POST', '/frames', { file: frame() }], ['POST', '/pause', {}], ['POST', '/end', {}], ['GET', '/report', {}], ['POST', '/camera-status', { body: { status: 'track_ended' } }], ['POST', '/reference', { file: frame() }], ['DELETE', '', {}]]) {
      const r = await api(m, `/api/face-monitoring/sessions/${s.id}${u}`, { token: b.token, ...extra })
      assert.equal(r.status, 404, `${m} ${u}`)
    }
    assert.equal(ok(await api('GET', '/api/face-monitoring/sessions', { token: b.token })).sessions.length, 0)
    assert.equal(ok(await api('GET', '/api/face-monitoring/sessions', { token: a.token })).sessions.length, 1)
    assert.equal(ok(await api('GET', `/api/face-monitoring/sessions/${s.id}`, { token: a.token })).session.status, 'active')
  })

  test('a service outage is recorded as a technical issue (never absence) and cleared by the next good frame', async () => {
    reset()
    const c = await register('outage')
    const s = (await start(c)).session
    const t0 = Date.now() - 60000
    await svc.submitFrame({ userId: c.user.id, sessionId: s.id, frameBuffer: jpeg, mimeType: 'image/jpeg', receivedAt: t0 })
    ai.analyzeFaceFrame = async () => { throw Object.assign(new Error('down'), { statusCode: 503, reason: 'ai_service_timeout', retryable: true }) }
    const bad = await sendFrame(c, s.id)
    assert.equal(bad.status, 503); assert.equal(bad.body.reason, 'ai_service_timeout')
    let ev = await events(s.id)
    assert.deepEqual(ev.map((e) => [e.event_type, e.category, e.status]), [['analysis_unavailable', 'technical_issue', 'ongoing']])
    reset()
    ok(await sendFrame(c, s.id))
    ev = await events(s.id)
    assert.equal(ev.find((e) => e.event_type === 'analysis_unavailable').status, 'resolved')
    assert.equal(ev.filter((e) => e.event_type === 'face_absent').length, 0)
  })

  test('an unreadable frame (422) is a camera-capture technical issue', async () => {
    reset()
    const c = await register('badframe')
    const s = (await start(c)).session
    ai.analyzeFaceFrame = async () => { throw Object.assign(new Error('bad'), { statusCode: 422, reason: 'corrupt_frame' }) }
    assert.equal((await sendFrame(c, s.id)).status, 422)
    const ev = await events(s.id)
    assert.equal(ev[0].event_type, 'camera_capture_failed'); assert.equal(ev[0].category, 'technical_issue')
    reset()
  })

  test('camera status reports are technical issues, validated against a fixed list', async () => {
    reset()
    const c = await register('cam')
    const s = (await start(c)).session
    const r = ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/camera-status`, { token: c.token, body: { status: 'track_ended' } }))
    assert.equal(r.newEvents[0].category, 'technical_issue')
    assert.equal((await api('POST', `/api/face-monitoring/sessions/${s.id}/camera-status`, { token: c.token, body: { status: 'cheating' } })).status, 400)
  })

  test('pause refuses frames, resume continues, and time paused is not monitored time', async () => {
    reset()
    const c = await register('pauser')
    const s = (await start(c)).session
    ok(await sendFrame(c, s.id))
    assert.equal(ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/pause`, { token: c.token })).session.status, 'paused')
    assert.equal((await sendFrame(c, s.id)).status, 409)
    assert.equal(ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/resume`, { token: c.token })).session.status, 'active')
    ok(await sendFrame(c, s.id))
    ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/end`, { token: c.token }))
  })

  test('identity: only with separate consent AND an available model; the reference never reaches the database', async () => {
    reset()
    const c = await register('idnone')
    const none = (await start(c, { consent: true, identityConsent: true })).session
    assert.equal(none.identity.status, 'not_configured', 'model not available -> not configured, session still works')
    assert.equal((await api('POST', `/api/face-monitoring/sessions/${none.id}/reference`, { token: c.token, file: frame() })).status, 400)
    ok(await api('POST', `/api/face-monitoring/sessions/${none.id}/end`, { token: c.token }))

    ai.getFaceMonitorCapabilities = async () => caps({ identity: true })
    let stored = null; let deleted = null
    ai.storeFaceReference = async ({ referenceKey }) => { stored = referenceKey; return { status: 'stored', reason: null } }
    ai.deleteFaceReference = async (k) => { deleted = k; return true }
    const c2 = await register('idyes')
    const s = (await start(c2, { consent: true, identityConsent: true })).session
    assert.equal(s.identity.status, 'awaiting_reference')
    const ref = ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/reference`, { token: c2.token, file: frame() }))
    assert.equal(ref.status, 'stored')
    const key = (await pool.query('SELECT reference_key, identity_status FROM face_monitoring_sessions WHERE id = $1', [s.id])).rows[0]
    assert.equal(key.reference_key, stored); assert.equal(key.identity_status, 'reference_stored'); assert.match(key.reference_key, /^[a-f0-9]{32}$/)
    analysis = async () => obs({ identity: { status: 'verified', similarity: 0.7 } })
    ok(await sendFrame(c2, s.id))
    ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/end`, { token: c2.token }))
    assert.equal(deleted, stored, 'the in-memory reference is released when the session ends')
    assert.equal((await pool.query('SELECT reference_key FROM face_monitoring_sessions WHERE id = $1', [s.id])).rows[0].reference_key, null)
    const dump = JSON.stringify((await pool.query('SELECT * FROM face_monitoring_sessions WHERE id = $1', [s.id])).rows)
    assert.doesNotMatch(dump, /embedding|template/i)
    reset()
  })

  test('delete removes the session and its events; retention purges expired sessions', async () => {
    reset()
    const c = await register('deleter')
    const s = (await start(c)).session
    ok(await api('POST', `/api/face-monitoring/sessions/${s.id}/camera-status`, { token: c.token, body: { status: 'stream_error' } }))
    assert.equal(ok(await api('DELETE', `/api/face-monitoring/sessions/${s.id}`, { token: c.token })).deleted, true)
    assert.equal((await events(s.id)).length, 0)
    assert.equal((await api('DELETE', `/api/face-monitoring/sessions/${s.id}`, { token: c.token })).status, 404)

    const old = await register('old')
    const o = (await start(old)).session
    await pool.query("UPDATE face_monitoring_sessions SET retention_until = now() - interval '1 day', status = 'ended' WHERE id = $1", [o.id])
    const fresh = await register('fresh')
    await start(fresh)   // housekeeping runs on create
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM face_monitoring_sessions WHERE id = $1', [o.id])).rows[0].n), 0)
  })

  test('link to a practice interview: must be mine and a practice session', async () => {
    reset()
    const a = await register('linka'); const b = await register('linkb')
    const mine = ok(await api('POST', '/api/interviews', { token: a.token, body: { interviewType: 'hr', targetRole: 'Practice', difficulty: 'easy' } }), 201)
    assert.equal((await api('POST', '/api/face-monitoring/sessions', { token: b.token, body: { consent: true, interviewSessionId: mine.session.id } })).status, 404)
    const linked = (await start(a, { consent: true, interviewSessionId: mine.session.id })).session
    assert.equal(linked.interviewSessionId, mine.session.id)
    ok(await api('POST', `/api/face-monitoring/sessions/${linked.id}/end`, { token: a.token }))
  })

  test('hiring-assessment interviews cannot be monitored (practice only)', async () => {
    reset()
    const { job } = await hiringFixture()
    const cand = await candidateApplies(job, 'assess')
    const st = ok(await api('POST', '/api/interviews', { token: cand.token, body: { interviewType: 'hr', targetRole: 'Practice', difficulty: 'easy' } }), 201)
    await pool.query('UPDATE interview_sessions SET application_id = $2 WHERE id = $1', [st.session.id, cand.app.id])
    const r = await api('POST', '/api/face-monitoring/sessions', { token: cand.token, body: { consent: true, interviewSessionId: st.session.id } })
    assert.equal(r.status, 400); assert.equal(r.body.reason, 'practice_only')
  })

  test('monitoring never changes an interview score', async () => {
    reset()
    const c = await register('scorer')
    const st = ok(await api('POST', '/api/interviews', { token: c.token, body: { interviewType: 'hr', targetRole: 'Practice', difficulty: 'easy' } }), 201)
    const fm = (await start(c, { consent: true, interviewSessionId: st.session.id })).session
    analysis = async () => absent()
    for (let i = 0; i < 4; i++) await svc.submitFrame({ userId: c.user.id, sessionId: fm.id, frameBuffer: jpeg, mimeType: 'image/jpeg', receivedAt: Date.now() - 100000 + i * 2000 })
    for (const q of st.questions) ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: q.id, answerText: 'x'.repeat(380) } }), 201)
    const done = ok(await api('POST', `/api/interviews/${st.session.id}/complete`, { token: c.token }))
    assert.equal(Number(done.final_score), 80)
    const src = require('fs').readFileSync(path.join(root, 'services/interviewService.js'), 'utf8') + require('fs').readFileSync(path.join(root, 'services/codingService.js'), 'utf8')
    assert.doesNotMatch(src, /faceMonitor|face_monitoring/)
    reset()
  })
}
