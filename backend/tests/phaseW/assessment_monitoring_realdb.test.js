// Phase W: camera monitoring of an assessment attempt with the AI service AVAILABLE (stubbed), through the REAL routes and
// SQL against a dedicated test database (env AIC_TEST_DB). Regression for "value too long for type character varying(20)":
// the assessment consent version did not fit face_monitoring_sessions.consent_version, so no session could be created.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

if (!process.env.AIC_TEST_DB) { test('Phase W assessment monitoring', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const { setup } = require('../phaseJ/harness')
  const { root } = require('../phaseA/helpers')
  const H = setup('assessmon')
  const { api, ok, tag, pool } = H
  const S = {}
  const ai = require(path.join(root, 'services/aiServiceClient'))
  ai.getFaceMonitorCapabilities = async () => ({
    reachable: true,
    faceMonitor: { available: true, state: 'ready', message: 'ok', features: { faceDetection: true, multipleFaces: true, imageQuality: true, headPose: false, gaze: false, identity: false } },
  })
  ai.analyzeFaceFrame = async () => ({ faceState: 'face_present', faceCount: 1, quality: { usable: true, issues: [], hints: [] } })
  ai.deleteFaceReference = async () => {}
  const frame = () => ({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), originalname: 'f.jpg', mimetype: 'image/jpeg', size: 9 })

  test('setup: published assessment with camera monitoring, one invited candidate who chose the camera', async () => {
    Object.assign(S, await H.hiringFixture())
    S.c = await H.candidateApplies(S.job, 'moncand')
    const q = ok(await api('POST', '/api/hirer/question-bank', { token: S.owner.token, body: { sectionKind: 'aptitude', category: 'numerical', questionText: `What is 3+3? ${tag}`, choices: ['5', '6', '7', '8'], correctKeys: ['B'] } }), 201).question
    const a = ok(await api('POST', '/api/hirer/assessments', { token: S.owner.token, body: { jobId: S.job.id, title: `Mon ${tag}`, instructions: 'Go.', durationMinutes: 30, sections: [{ kind: 'aptitude', items: [{ mcqQuestionId: q.id }] }] } }), 201)
    S.aid = a.assessment.id
    ok(await api('POST', `/api/hirer/assessments/${S.aid}/publish`, { token: S.owner.token }))
    ok(await api('POST', `/api/hirer/assessments/${S.aid}/invitations`, { token: S.owner.token, body: { applicationIds: [S.c.app.id] } }))
    const inv = ok(await api('GET', '/api/assessments', { token: S.c.token })).invitations[0].invitationId
    S.att = ok(await api('POST', `/api/assessments/invitations/${inv}/start`, { token: S.c.token, body: { acceptTerms: true, monitoring: 'camera' } })).attemptId
  })

  test('monitoring starts: a session linked to the attempt, with a consent version that fits its column', async () => {
    const m = ok(await api('POST', `/api/assessments/attempts/${S.att}/monitoring`, { token: S.c.token }), 201)
    assert.equal(m.session.status, 'active'); assert.equal(m.session.assessmentAttemptId, S.att)
    S.sid = m.session.id
    const { rows } = await pool.query('SELECT consent_version, assessment_attempt_id, identity_consent FROM face_monitoring_sessions WHERE id = $1', [S.sid])
    assert.ok(rows[0].consent_version.length <= 20, rows[0].consent_version)
    assert.match(rows[0].consent_version, /^assess-/)
    assert.equal(Number(rows[0].assessment_attempt_id), S.att); assert.equal(rows[0].identity_consent, false, 'no same-person check in assessments')
  })

  test('frames are analysed through the existing frame endpoint; camera problems become technical events', async () => {
    for (let i = 0; i < 3; i++) ok(await api('POST', `/api/face-monitoring/sessions/${S.sid}/frames`, { token: S.c.token, file: frame() }))
    const s = ok(await api('GET', `/api/face-monitoring/sessions/${S.sid}`, { token: S.c.token }))
    assert.equal(s.session.totals.framesAnalysed, 3); assert.equal(s.session.totals.framesWithFace, 3)
    ok(await api('POST', `/api/face-monitoring/sessions/${S.sid}/camera-status`, { token: S.c.token, body: { status: 'permission_denied' } }))
    const after = ok(await api('GET', `/api/face-monitoring/sessions/${S.sid}`, { token: S.c.token }))
    assert.ok(after.events.some((e) => e.category === 'technical_issue'))
    ok(await api('POST', `/api/assessments/attempts/${S.att}/monitoring-issues`, { token: S.c.token, body: { issue: 'camera_denied' } }))
  })

  test('after a page refresh the same session continues instead of failing', async () => {
    const again = ok(await api('POST', `/api/assessments/attempts/${S.att}/monitoring`, { token: S.c.token }), 201)
    assert.equal(again.resumed, true); assert.equal(again.session.id, S.sid)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM face_monitoring_sessions WHERE assessment_attempt_id = $1', [S.att])).rows[0].n, 1)
  })

  test('submitting ends the session; the hiring team sees it as observations, separate from the score', async () => {
    ok(await api('POST', `/api/assessments/attempts/${S.att}/submit`, { token: S.c.token }))
    const { rows } = await pool.query('SELECT status FROM face_monitoring_sessions WHERE id = $1', [S.sid])
    assert.equal(rows[0].status, 'ended')
    const d = ok(await api('GET', `/api/hirer/assessments/attempts/${S.att}`, { token: S.owner.token }))
    assert.equal(d.monitoring.available, true); assert.equal(d.monitoring.sessions.length, 1)
    const meas = d.monitoring.sessions[0].measurements
    assert.equal(meas.framesTotal, 3); assert.equal(meas.framesFacePresent, 3); assert.equal(meas.framesUnusable, 0)
    assert.equal(meas.headEvaluatedMs, 0, 'head pose unavailable on this service: nothing measured, reported as such')
    assert.equal(JSON.stringify(d.monitoring).match(/"(score|attentionScore)"/), null)
    assert.ok(d.monitoring.issues.some((i) => i.issue === 'camera_denied'))
    assert.equal(d.overview.totalScore, 0, 'unanswered question: 0, whatever monitoring recorded')
    const { rows: app } = await pool.query('SELECT status FROM applications WHERE id = $1', [S.c.app.id])
    assert.equal(app[0].status, 'submitted')
  })
}
