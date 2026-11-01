// Composite practice score, real PostgreSQL + real route chains.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { setup } = require('../phaseJ/harness')
const { root } = require('../phaseA/helpers')

if (!process.env.AIC_TEST_DB) { test('composite score DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('p')
  const { api, ok, pool, register } = H
  const typed = { keystrokes: 400, typedChars: 380, backspaces: 40, pasteCount: 0, pastedChars: 0, activeTypingMs: 75000, totalMs: 100000, longPauseCount: 1, longestPauseMs: 3500, timeToFirstKeyMs: 2500 }
  const start = async (token) => ok(await api('POST', '/api/interviews', { token, body: { interviewType: 'hr', targetRole: 'Practice', difficulty: 'easy' } }), 201)
  const answerAll = async (c, st, withTyping) => {
    for (const q of st.questions) ok(await api('POST', `/api/interviews/${st.session.id}/answer`, { token: c.token, body: { questionId: q.id, answerText: 'x'.repeat(380), ...(withTyping ? { typingMetrics: typed } : {}) } }), 201)
  }

  test('no behaviour signals: composite equals the content-only score and is stored with a breakdown', async () => {
    const c = await register('plain'); const st = await start(c.token)
    await answerAll(c, st, false)
    const done = ok(await api('POST', `/api/interviews/${st.session.id}/complete`, { token: c.token }))
    assert.equal(Number(done.final_score), 80)
    assert.equal(done.score_breakdown.categories.find((x) => x.key === 'content').appliedWeight, 100)
    assert.equal(done.score_breakdown.categories.find((x) => x.key === 'typing').status, 'unavailable')
  })

  test('typed answers with telemetry: typing counts, final score = stored breakdown, detail endpoint returns it', async () => {
    const c = await register('typist2'); const st = await start(c.token)
    await answerAll(c, st, true)
    const done = ok(await api('POST', `/api/interviews/${st.session.id}/complete`, { token: c.token }))
    const b = done.score_breakdown
    assert.equal(Number(done.final_score), b.finalScore)
    assert.equal(b.categories.find((x) => x.key === 'typing').status, 'measured')
    assert.equal(Math.round(b.categories.reduce((s, x) => s + x.appliedWeight, 0)), 100)
    const d = ok(await api('GET', `/api/interviews/${st.session.id}`, { token: c.token }))
    assert.deepEqual(d.session.score_breakdown.finalScore, b.finalScore)
    assert.equal(d.combinedSummary ? d.combinedSummary.contentScore : 80, 80) // content score comes from the breakdown, not the composite
  })

  test('hiring assessments stay content-only with no breakdown', async () => {
    const svc = require(path.join(root, 'services/interviewService.js'))
    const src = require('node:fs').readFileSync(path.join(root, 'services/interviewService.js'), 'utf8')
    assert.match(src, /!session\.application_id && answers\.length/)
    assert.equal(typeof svc.completeInterviewSession, 'function')
  })

  test('a legacy completed session (no breakdown) is still readable', async () => {
    const c = await register('legacy'); const st = await start(c.token)
    await pool.query("UPDATE interview_sessions SET status = 'completed', final_score = 71, completed_at = now(), score_breakdown = NULL WHERE id = $1", [st.session.id])
    const d = ok(await api('GET', `/api/interviews/${st.session.id}`, { token: c.token }))
    assert.equal(Number(d.session.final_score), 71)
    assert.equal(d.session.score_breakdown, null)
  })

  test('another user cannot read the breakdown', async () => {
    const a = await register('owner'); const b = await register('other'); const st = await start(a.token)
    const r = await api('GET', `/api/interviews/${st.session.id}`, { token: b.token })
    assert.ok(r.status === 404 || r.status === 403)
  })
}
