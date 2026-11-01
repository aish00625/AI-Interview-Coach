// Phase M, real PostgreSQL + real route chains: typing metrics, delivery summary, privacy, error propagation, export.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { setup } = require('../phaseJ/harness')
const { root } = require('../phaseA/helpers')

if (!process.env.AIC_TEST_DB) { test('Phase M delivery DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('m')
  const { api, ok, pool, register } = H
  const ai = require(path.join(root, 'services/aiServiceClient'))   // the harness stub object (same instance the services hold)
  const svc = require(path.join(root, 'services/interviewService.js'))
  const speech = { transcript: 'a spoken answer about deadlocks and how to avoid them in practice', technicalScore: 70, relevanceScore: 70, clarityScore: 70, completenessScore: 70,
    strengths: [], weaknesses: [], suggestedImprovement: 's', modelAnswer: 'm', evaluationMeta: null,
    speechMetrics: { schemaVersion: 2, durationSeconds: 20, wordCount: 60, speakingRateWpm: 150, articulationRateWpm: 150, fillerWordCount: 1, fillerWords: { um: 1 }, pauseCount: 2, averagePauseSeconds: 0.8, disfluencyRatePer100Words: 1.5, longPauseCount: 0, reliable: true, unreliableReasons: [] } }
  const cam = { analysisStatus: 'model_unavailable', framesAnalyzed: 20, framesWithFace: 19, facePresent: true, facePresenceRatio: 0.95, framesWithGaze: null, framesWithHeadPose: null, lookingAwayRatio: null, averageGazeDeviation: null, headPose: null }
  const typed = { keystrokes: 400, typedChars: 380, backspaces: 40, pasteCount: 0, pastedChars: 0, activeTypingMs: 75000, totalMs: 100000, longPauseCount: 1, longestPauseMs: 3500, timeToFirstKeyMs: 2500 }

  const startPractice = async (token) => ok(await api('POST', '/api/interviews', { token, body: { interviewType: 'hr', targetRole: 'Practice', difficulty: 'easy' } }), 201)

  test('typing metrics are derived server-side, stored, and shown with a delivery summary; content formula untouched, typing counts in the composite', async () => {
    const c = await register('typist')
    const st = await startPractice(c.token)
    const [q1, q2] = st.questions
    ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: q1.id, answerText: 'x'.repeat(380), typingMetrics: { ...typed, typingSpeedWpm: 999 } } }), 201)
    ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: q2.id, answerText: 'plain answer without telemetry' } }), 201)
    const d = ok(await api('GET', `/api/interviews/${st.session.id}`, { token: c.token }))
    const a1 = d.questions.find((q) => q.id === q1.id).answer; const a2 = d.questions.find((q) => q.id === q2.id).answer
    assert.equal(a1.typing_metrics.typingSpeedWpm, 60.8); assert.equal(a1.typing_metrics.correctionRatio, 0.1)
    assert.equal(a2.typing_metrics, null)
    assert.equal(a1.behavior_summary.advisory, true); assert.ok(a1.behavior_summary.components.some((x) => x.key === 'typingPace'))
    assert.equal(a2.behavior_summary.score, null)
    assert.equal(d.delivery.answersTotal, st.questions.length)
    // content score formula untouched: mean of the four sub-scores (stub gives 85/75/65/95 -> 80)
    for (const q of st.questions.slice(2)) ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: q.id, answerText: 'a' } }), 201)
    const done = ok(await api('POST', `/api/interviews/${st.session.id}/complete`, { token: c.token }))
    // Since scoring v1 the measured typing signals count (transparently): content stays 80, and final_score is the stored composite.
    assert.equal(done.score_breakdown.contentScore, 80)
    assert.equal(Number(done.final_score), done.score_breakdown.finalScore)
    assert.equal(done.score_breakdown.categories.find((x) => x.key === 'typing').status, 'measured')
  })

  test('voice + camera: delivery summary is computed on read, so a clip attached later is included', async () => {
    const c = await register('speaker')
    const st = await startPractice(c.token); const q = st.questions[0]; const uid = c.user.id
    ai.evaluateSpeechAnswer = async () => speech
    ai.analyzeVideoAnswer = async () => cam
    await svc.submitAudioAnswer({ sessionId: st.session.id, userId: uid, questionId: q.id, audioBuffer: Buffer.from('a'), audioMimeType: 'audio/webm' })
    let d = ok(await api('GET', `/api/interviews/${st.session.id}`, { token: c.token }))
    let a = d.questions.find((x) => x.id === q.id).answer
    assert.equal(a.audio_transcript, speech.transcript); assert.deepEqual(a.behavior_summary.components.map((x) => x.key), ['pace', 'fluency', 'pausing'])
    await svc.submitVideoAnswer({ sessionId: st.session.id, userId: uid, questionId: q.id, videoBuffer: Buffer.from('v'), videoMimeType: 'video/webm' })
    d = ok(await api('GET', `/api/interviews/${st.session.id}`, { token: c.token }))
    a = d.questions.find((x) => x.id === q.id).answer
    assert.ok(a.behavior_summary.components.some((x) => x.key === 'presence'))
    assert.ok(a.behavior_summary.limitations.some((l) => /landmark model/.test(l)))
  })

  test('a failed speech evaluation creates no answer row and surfaces the AI reason through the real error handler', async () => {
    const c = await register('failer')
    const st = await startPractice(c.token); const q = st.questions[0]
    ai.evaluateSpeechAnswer = async () => { throw Object.assign(new Error('Model is loading'), { statusCode: 503, reason: 'speech_model_loading', retryable: true }) }
    const origErr = console.error; console.error = () => {}
    try {
      await assert.rejects(svc.submitAudioAnswer({ sessionId: st.session.id, userId: c.user.id, questionId: q.id, audioBuffer: Buffer.from('a'), audioMimeType: 'audio/webm' }), (e) => e.reason === 'speech_model_loading')
    } finally { console.error = origErr }
    const rows = await pool.query('SELECT 1 FROM interview_answers WHERE question_id = $1', [q.id])
    assert.equal(rows.rowCount, 0)
  })

  test('hiring assessments store no typing telemetry and show no delivery data; hirers never see it', async () => {
    const F = await H.hiringFixture()
    const p = await pool.query('SELECT id FROM coding_problems ORDER BY id LIMIT 1')
    ok(await api('PUT', `/api/hirer/jobs/${F.job.id}/assessment`, { token: F.owner.token, body: { interviewEnabled: true, interviewType: 'technical', interviewDifficulty: 'easy', problemIds: [p.rows[0].id] } }))
    const c = await H.candidateApplies(F.job, 'assess')
    const st = ok(await api('POST', `/api/applications/${c.app.id}/assessment/interview`, { token: c.token }), 201)
    for (const q of st.questions) ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: q.id, answerText: 'z'.repeat(300), typingMetrics: typed } }), 201)
    const rows = await pool.query('SELECT typing_metrics FROM interview_answers ia JOIN interview_questions iq ON iq.id = ia.question_id WHERE iq.session_id = $1', [st.session.id])
    assert.ok(rows.rows.length > 0 && rows.rows.every((r) => r.typing_metrics === null))
    const d = ok(await api('GET', `/api/interviews/${st.session.id}`, { token: c.token }))
    assert.equal(d.delivery, undefined); assert.ok(d.questions.every((q) => !q.answer || q.answer.behavior_summary === undefined))
    const rev = JSON.stringify(ok(await api('GET', `/api/hirer/applications/${c.app.id}`, { token: F.owner.token })))
    for (const w of ['typing', 'behavior', 'delivery', 'speech_metrics', 'cv_metrics']) assert.ok(!rev.toLowerCase().includes(w), `hirer view leaks ${w}`)
  })

  test('capabilities route is candidate-only, registered before /:id, and passes through the client result', async () => {
    const c = await register('capa')
    ai.getCapabilities = async () => ({ reachable: true, speech: { state: 'loading' }, vision: { state: 'unavailable' } })
    const r = ok(await api('GET', '/api/interviews/capabilities', { token: c.token }))
    assert.equal(r.speech.state, 'loading')
    assert.equal((await api('GET', '/api/interviews/capabilities')).status, 401)
  })

  test('data export includes the candidate\'s own typing metrics', async () => {
    const c = await register('exporter')
    const st = await startPractice(c.token)
    ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: st.questions[0].id, answerText: 'y'.repeat(380), typingMetrics: typed } }), 201)
    const exp = JSON.stringify(ok(await api('GET', '/api/account/export', { token: c.token })))
    assert.ok(exp.includes('typing_metrics') && exp.includes('typingSpeedWpm'))
  })
}
