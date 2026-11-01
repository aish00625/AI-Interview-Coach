// Phase O, REAL PostgreSQL + REAL route chains for the local-AI features. The language model itself is replaced by a
// controllable fake (services/localAiClient is stubbed), so these tests prove the surrounding rules - ownership, practice-only,
// fallbacks, "AI never changes scores", persistence - and say nothing about the quality of a real model's text.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')

const fake = {
  calls: [],
  down: false,
  impl: {},
}
const llmError = () => Object.assign(new Error('The local AI model (Ollama) is not running. Start Ollama and try again.'), { statusCode: 503, reason: 'llm_unreachable', retryable: true })
const wrap = (name, fn) => async (arg) => { fake.calls.push({ name, arg }); if (fake.down) throw llmError(); return (fake.impl[name] || fn)(arg) }
stubModule(path.join(root, 'services/localAiClient'), {
  getStatus: async () => (fake.down ? { state: 'unreachable', model: 'qwen3:4b', message: 'Ollama is not running.' } : { state: 'ready', model: 'qwen3:4b', installedModels: ['qwen3:4b'] }),
  followUp: wrap('followUp', async ({ previousTurns }) => ({ prompt: previousTurns.length ? 'Can you give a concrete example of that?' : 'How would you test that under heavy load?', reason: 'You did not mention testing.', model: 'qwen3:4b' })),
  followUpFeedback: wrap('followUpFeedback', async () => ({ feedback: 'Clear example; add numbers next time.', strength: 'Concrete', improve: 'Quantify', model: 'qwen3:4b' })),
  star: wrap('star', async () => ({
    elements: Object.fromEntries(['situation', 'task', 'action', 'result'].map((k) => [k, { status: k === 'result' ? 'weak' : 'present', evidence: 'an answer', suggestion: 'Add detail.' }])),
    overall: 'Decent structure.', evidenceDropped: 0, model: 'qwen3:4b',
  })),
  codeCoach: wrap('codeCoach', async () => ({ summary: 'Your loop stops one step early.', failureExplanation: 'Off by one.', hints: ['Trace the last iteration.'], edgeCases: ['empty input'], complexity: { time: 'O(n)', space: 'O(1)', note: 'Approximate' }, model: 'qwen3:4b' })),
  report: wrap('report', async () => ({ summary: 'A solid practice run.', strengths: ['Clear'], improvements: ['Depth'], nextSteps: ['Practise SQL'], model: 'qwen3:4b' })),
})

const { setup } = require('../phaseJ/harness')

if (!process.env.AIC_TEST_DB) { test('Phase O local AI DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('o')
  const { api, ok, pool, register, candidateApplies, hiringFixture, tag } = H
  const created = { problems: [] }
  const reset = () => { fake.calls.length = 0; fake.down = false; fake.impl = {} }

  async function interview(token, type = 'technical') {
    const d = ok(await api('POST', '/api/interviews', { token, body: { interviewType: type, targetRole: `Backend ${tag}`, difficulty: 'easy' } }), 201)
    return { id: d.session.id, questions: d.questions }
  }
  async function answerQ(token, sid, qid, text = 'I would use a cache and an index to speed up reads.') {
    return ok(await api('POST', `/api/interviews/${sid}/answer`, { token, body: { questionId: qid, answerText: text } }), 201)
  }
  const setMeta = (qid, meta) => pool.query('UPDATE interview_answers SET evaluation_meta = $2 WHERE question_id = $1', [qid, JSON.stringify(meta)])

  test('access control: 401 without a token, 403 for a hirer, on every new route', async () => {
    const hirer = await register('hirerO', { role: 'hirer', companyName: `Org ${tag}` })
    const routes = [
      ['GET', '/api/dashboard/ai-status'], ['GET', '/api/dashboard/plan'],
      ['POST', '/api/interviews/1/follow-ups', { questionId: 1 }], ['POST', '/api/interviews/1/follow-ups/1/answer', { answerText: 'x' }], ['POST', '/api/interviews/1/follow-ups/1/skip'],
      ['GET', '/api/interviews/1/questions/1/star'], ['POST', '/api/interviews/1/questions/1/star'],
      ['GET', '/api/interviews/1/ai-report'], ['POST', '/api/interviews/1/ai-report'],
      ['POST', '/api/coding/coach', { problemId: 1, language: 'python', sourceCode: 'print(1)' }],
    ]
    for (const [m, p, body] of routes) {
      assert.equal((await api(m, p, { body })).status, 401, `${m} ${p} unauthenticated`)
      assert.equal((await api(m, p, { token: hirer.token, body })).status, 403, `${m} ${p} hirer`)
    }
  })

  test('follow-up flow: ask -> same open turn on repeat -> answer with advisory feedback -> second turn -> limit; scores untouched', async () => {
    reset()
    const c = await register('fu1')
    const s = await interview(c.token)
    const q1 = s.questions[0].id
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q1 } })).status, 409, 'must answer the question first')
    await answerQ(c.token, s.id, q1)
    const before = (await pool.query('SELECT count(*)::int AS n FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id WHERE q.session_id = $1', [s.id])).rows[0].n

    const t1 = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q1 } }), 201)
    assert.equal(t1.available, true); assert.equal(t1.followUp.source, 'local_ai'); assert.equal(t1.followUp.model, 'qwen3:4b'); assert.equal(t1.followUp.turnNo, 1)
    const again = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q1 } }))
    assert.equal(again.followUp.id, t1.followUp.id); assert.equal(again.created, false)
    assert.equal(fake.calls.filter((x) => x.name === 'followUp').length, 1, 'the model is not called again for an open turn')

    const a1 = ok(await api('POST', `/api/interviews/${s.id}/follow-ups/${t1.followUp.id}/answer`, { token: c.token, body: { answerText: 'Load test with k6 and watch p95.' } }))
    assert.equal(a1.followUp.status, 'answered'); assert.equal(a1.followUp.feedback.source, 'local_ai'); assert.match(a1.followUp.feedback.advisory, /advisory/i); assert.equal(a1.canAskAnother, true)
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups/${t1.followUp.id}/answer`, { token: c.token, body: { answerText: 'again' } })).status, 409, 'cannot answer twice')

    const t2 = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q1 } }), 201)
    assert.equal(t2.followUp.turnNo, 2)
    const sent = fake.calls.filter((x) => x.name === 'followUp')[1].arg
    assert.equal(sent.previousTurns.length, 1); assert.equal(sent.previousTurns[0].answer, 'Load test with k6 and watch p95.')
    ok(await api('POST', `/api/interviews/${s.id}/follow-ups/${t2.followUp.id}/answer`, { token: c.token, body: { answerText: 'Second answer' } }))
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q1 } })).status, 409, 'maximum turns reached')

    const detail = ok(await api('GET', `/api/interviews/${s.id}`, { token: c.token }))
    assert.equal(detail.followUps.length, 2)
    const after = (await pool.query('SELECT count(*)::int AS n FROM interview_answers ia JOIN interview_questions q ON q.id = ia.question_id WHERE q.session_id = $1', [s.id])).rows[0].n
    assert.equal(after, before, 'follow-up answers are NOT interview answers')
    const done = ok(await api('POST', `/api/interviews/${s.id}/complete`, { token: c.token }))
    assert.equal(Number(done.final_score), 80, 'final score = the one scored answer (85+75+65+95)/4; follow-ups do not count')
  })

  test('skip closes the turn; an open follow-up is closed when the interview is completed', async () => {
    reset()
    const c = await register('fu2')
    const s = await interview(c.token)
    await answerQ(c.token, s.id, s.questions[0].id)
    const t = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: s.questions[0].id } }), 201)
    const sk = ok(await api('POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/skip`, { token: c.token }))
    assert.equal(sk.followUp.status, 'skipped')
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: s.questions[0].id } })).status, 409)
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/answer`, { token: c.token, body: { answerText: 'late' } })).status, 409)

    await answerQ(c.token, s.id, s.questions[1].id)
    const open = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: s.questions[1].id } }), 201)
    ok(await api('POST', `/api/interviews/${s.id}/complete`, { token: c.token }))
    const row = (await pool.query('SELECT status FROM interview_followups WHERE id = $1', [open.followUp.id])).rows[0]
    assert.equal(row.status, 'skipped')
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: s.questions[1].id } })).status, 409, 'completed interviews take no follow-ups')
  })

  test('model unavailable: authored rule-based follow-up when the question bank has one, otherwise available:false and nothing is stored', async () => {
    reset(); fake.down = true
    const c = await register('fu3')
    const s = await interview(c.token)
    const [q1, q2] = s.questions.map((q) => q.id)
    await answerQ(c.token, s.id, q1); await answerQ(c.token, s.id, q2)
    await setMeta(q1, { confidence: 'medium', followUps: ['Authored: what about indexing?'], missingCriteria: ['indexing'] })

    const r1 = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q1 } }), 201)
    assert.equal(r1.available, true); assert.equal(r1.followUp.source, 'rule_based'); assert.equal(r1.followUp.model, null); assert.equal(r1.followUp.prompt, 'Authored: what about indexing?')

    const r2 = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: q2 } }))
    assert.equal(r2.available, false); assert.equal(r2.reason, 'llm_unreachable'); assert.match(r2.message, /Ollama/)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM interview_followups WHERE question_id = $1', [q2])).rows[0].n, 0)
    // a rule-based turn gets no AI feedback and still works
    const a = ok(await api('POST', `/api/interviews/${s.id}/follow-ups/${r1.followUp.id}/answer`, { token: c.token, body: { answerText: 'Add a B-tree index.' } }))
    assert.equal(a.followUp.status, 'answered'); assert.equal(a.followUp.feedback, null)
  })

  test('model feedback failure on an answer does not lose the answer', async () => {
    reset()
    const c = await register('fu4')
    const s = await interview(c.token)
    await answerQ(c.token, s.id, s.questions[0].id)
    const t = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: s.questions[0].id } }), 201)
    fake.down = true
    const a = ok(await api('POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/answer`, { token: c.token, body: { answerText: 'My answer' } }))
    assert.equal(a.followUp.status, 'answered'); assert.equal(a.followUp.answerText, 'My answer'); assert.equal(a.feedbackUnavailable.reason, 'llm_unreachable')
  })

  test('privacy: another candidate gets 404 for every follow-up, STAR and report route; bad ids and URL mismatches too', async () => {
    reset()
    const a = await register('own1'); const b = await register('other1')
    const s = await interview(a.token)
    await answerQ(a.token, s.id, s.questions[0].id)
    const t = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: a.token, body: { questionId: s.questions[0].id } }), 201)
    const q = s.questions[0].id
    const attempts = [
      ['POST', `/api/interviews/${s.id}/follow-ups`, { questionId: q }], ['POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/answer`, { answerText: 'x' }],
      ['POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/skip`], ['GET', `/api/interviews/${s.id}/questions/${q}/star`], ['POST', `/api/interviews/${s.id}/questions/${q}/star`],
      ['GET', `/api/interviews/${s.id}/ai-report`], ['POST', `/api/interviews/${s.id}/ai-report`],
    ]
    for (const [m, p, body] of attempts) assert.equal((await api(m, p, { token: b.token, body })).status, 404, `${m} ${p}`)
    const other = await interview(a.token)
    assert.equal((await api('POST', `/api/interviews/${other.id}/follow-ups/${t.followUp.id}/skip`, { token: a.token })).status, 404, 'follow-up id from a different session in the URL')
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: a.token, body: { questionId: other.questions[0].id } })).status, 404, 'question from another session')
    assert.equal(fake.calls.filter((x) => x.name !== 'followUp').length, 0, 'the model was never reached by an unauthorised request')
    const leak = await pool.query('SELECT count(*)::int AS n FROM interview_followups WHERE session_id = $1', [s.id])
    assert.equal(leak.rows[0].n, 1)
  })

  test('hiring assessments are refused: no follow-ups, STAR or report, and nothing AI is stored for them', async () => {
    reset()
    const { job } = await hiringFixture()
    const cand = await candidateApplies(job, 'assess')
    const { rows } = await pool.query(
      `INSERT INTO interview_sessions (user_id, interview_type, target_role, difficulty, application_id) VALUES ($1,'technical','Backend','easy',$2) RETURNING id`, [cand.user.id, cand.app.id])
    const sid = rows[0].id
    const qr = await pool.query(`INSERT INTO interview_questions (session_id, question_text, order_index) VALUES ($1,'Assessment question',1) RETURNING id`, [sid])
    await pool.query(`INSERT INTO interview_answers (question_id, answer_text, technical_score, relevance_score, clarity_score, completeness_score) VALUES ($1,'my answer',70,70,70,70)`, [qr.rows[0].id])
    const qid = qr.rows[0].id
    for (const [m, p, body] of [['POST', `/api/interviews/${sid}/follow-ups`, { questionId: qid }], ['POST', `/api/interviews/${sid}/questions/${qid}/star`], ['POST', `/api/interviews/${sid}/ai-report`], ['GET', `/api/interviews/${sid}/ai-report`]]) {
      assert.equal((await api(m, p, { token: cand.token, body })).status, 403, `${m} ${p}`)
    }
    assert.equal(fake.calls.length, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM interview_followups WHERE session_id = $1', [sid])).rows[0].n, 0)
    const detail = ok(await api('GET', `/api/interviews/${sid}`, { token: cand.token }))
    assert.equal('followUps' in detail, false, 'assessment detail carries no follow-up data')
  })

  test('input rules: empty and oversize follow-up answers are rejected; an interview without an answer text is refused', async () => {
    reset()
    const c = await register('fu5')
    const s = await interview(c.token)
    await answerQ(c.token, s.id, s.questions[0].id)
    const t = ok(await api('POST', `/api/interviews/${s.id}/follow-ups`, { token: c.token, body: { questionId: s.questions[0].id } }), 201)
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/answer`, { token: c.token, body: { answerText: '   ' } })).status, 400)
    assert.equal((await api('POST', `/api/interviews/${s.id}/follow-ups/${t.followUp.id}/answer`, { token: c.token, body: { answerText: 'x'.repeat(4001) } })).status, 400)
    assert.equal((await pool.query('SELECT status FROM interview_followups WHERE id = $1', [t.followUp.id])).rows[0].status, 'open')
  })

  test('STAR coaching: AI result saved and re-readable; rule-based fallback with real evidence; empty answer refused', async () => {
    reset()
    const c = await register('star1')
    const s = await interview(c.token, 'behavioral')
    const q = s.questions[0].id
    assert.equal((await api('POST', `/api/interviews/${s.id}/questions/${q}/star`, { token: c.token })).status, 409, 'no answer yet')
    assert.equal(ok(await api('GET', `/api/interviews/${s.id}/questions/${q}/star`, { token: c.token })).saved, false)
    const text = 'Last year our team missed a release date. I was responsible for the login module, so I reorganised tasks and wrote a test script. We shipped two days later and cut bugs by 30%.'
    await answerQ(c.token, s.id, q, text)

    const r = ok(await api('POST', `/api/interviews/${s.id}/questions/${q}/star`, { token: c.token }))
    assert.equal(r.source, 'local_ai'); assert.equal(r.model, 'qwen3:4b'); assert.deepEqual(r.weak, ['result']); assert.match(r.note, /advisory/i)
    const saved = ok(await api('GET', `/api/interviews/${s.id}/questions/${q}/star`, { token: c.token }))
    assert.equal(saved.saved, true); assert.equal(saved.elements.result.status, 'weak')

    fake.down = true
    const fb = ok(await api('POST', `/api/interviews/${s.id}/questions/${q}/star`, { token: c.token }))
    assert.equal(fb.source, 'rule_based'); assert.equal(fb.model, null); assert.equal(fb.aiUnavailable.reason, 'llm_unreachable')
    assert.ok(text.includes(fb.elements.result.evidence.replace(/\.$/, '')), 'rule-based evidence is a real sentence from the answer')
    assert.equal(fb.elements.result.status, 'present')
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ai_feedback WHERE user_id = $1 AND kind = 'star'`, [c.user.id])).rows[0].n, 1, 'regenerating replaces, not duplicates')
  })

  test('final report: only after completion; AI report saved; rule-based fallback uses the real score; never changes the score', async () => {
    reset()
    const c = await register('rep1')
    const s = await interview(c.token)
    await answerQ(c.token, s.id, s.questions[0].id); await answerQ(c.token, s.id, s.questions[1].id)
    assert.equal((await api('POST', `/api/interviews/${s.id}/ai-report`, { token: c.token })).status, 409)
    ok(await api('POST', `/api/interviews/${s.id}/complete`, { token: c.token }))
    assert.equal(ok(await api('GET', `/api/interviews/${s.id}/ai-report`, { token: c.token })).saved, false)

    const r = ok(await api('POST', `/api/interviews/${s.id}/ai-report`, { token: c.token }))
    assert.equal(r.source, 'local_ai'); assert.equal(r.report.summary, 'A solid practice run.')
    const sent = fake.calls.find((x) => x.name === 'report').arg
    assert.equal(sent.items.length, 2); assert.equal(sent.finalScore, 80)
    assert.ok(!JSON.stringify(sent).includes('"modelAnswer"') && sent.items.every((i) => !('modelAnswer' in i)), 'model answers are never sent to the model')

    fake.down = true
    const f = ok(await api('POST', `/api/interviews/${s.id}/ai-report`, { token: c.token }))
    assert.equal(f.source, 'rule_based'); assert.match(f.report.summary, /80\/100/); assert.equal(f.aiUnavailable.reason, 'llm_unreachable')
    assert.equal(ok(await api('GET', `/api/interviews/${s.id}/ai-report`, { token: c.token })).source, 'rule_based')
    const score = (await pool.query('SELECT final_score FROM interview_sessions WHERE id = $1', [s.id])).rows[0].final_score
    assert.equal(Number(score), 80)
  })

  test('coding coach: executor result is returned untouched; AI text sits beside it; fallback is rule-based; no hidden data reaches the model', async () => {
    reset()
    const c = await register('coach1')
    const tid = (await pool.query('SELECT id FROM topics LIMIT 1')).rows[0].id
    const p = await pool.query(
      `INSERT INTO coding_problems (topic_id, title, description, difficulty, test_cases) VALUES ($1,$2,'Add two numbers.','easy',$3) RETURNING id`,
      [tid, `Coach ${tag}`, JSON.stringify([{ input: '1 2', expected_output: '3', is_hidden: false }, { input: '9 9', expected_output: 'SECRET-HIDDEN-EXPECTED', is_hidden: true }])])
    created.problems.push(p.rows[0].id)
    const body = { problemId: p.rows[0].id, language: 'python', sourceCode: 'print(1)' }

    const r = ok(await api('POST', '/api/coding/coach', { token: c.token, body }))
    assert.equal(r.run.status, 'completed'); assert.equal(r.run.recorded, false)
    assert.equal(r.coaching.source, 'local_ai'); assert.equal(r.coaching.hints.length, 1); assert.match(r.coaching.advisory, /cannot be changed/)
    assert.ok(!('passed' in r.coaching) && !('status' in r.coaching), 'the coaching object has no pass/fail field')
    const sentJson = JSON.stringify(fake.calls.find((x) => x.name === 'codeCoach').arg)
    assert.ok(!sentJson.includes('SECRET-HIDDEN-EXPECTED') && !sentJson.includes('9 9'), 'hidden tests never reach the model')
    assert.ok(sentJson.includes('Add two numbers.'))
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM coding_submissions WHERE user_id = $1', [c.user.id])).rows[0].n, 0, 'coaching records no submission')

    fake.down = true
    const f = ok(await api('POST', '/api/coding/coach', { token: c.token, body }))
    assert.equal(f.coaching.source, 'rule_based'); assert.equal(f.aiUnavailable.reason, 'llm_unreachable'); assert.equal(f.run.status, 'completed')
    assert.equal((await api('POST', '/api/coding/coach', { token: c.token, body: { ...body, problemId: 999999999 } })).status, 404)
  })

  test('daily plan: starter plan with no invented numbers for a new user; real reasons for a user with history; no other user data', async () => {
    reset()
    const fresh = await register('plan0')
    const p0 = ok(await api('GET', '/api/dashboard/plan', { token: fresh.token }))
    assert.equal(p0.basis, 'no_history'); assert.equal(p0.source, 'rule_based'); assert.ok(p0.tasks.length >= 2)
    assert.ok(!JSON.stringify(p0).match(/\d+%/), 'no statistics are invented for a user with no history')

    const c = await register('plan1')
    const s = await interview(c.token)
    await answerQ(c.token, s.id, s.questions[0].id)
    ok(await api('POST', `/api/interviews/${s.id}/complete`, { token: c.token }))
    const p1 = ok(await api('GET', '/api/dashboard/plan', { token: c.token }))
    assert.equal(p1.basis, 'practice_history'); assert.ok(p1.tasks.length >= 1 && p1.tasks.length <= 4)
    assert.ok(p1.tasks.every((t) => t.reason && t.link && t.suggestedMinutes > 0))
    const other = await register('plan2')
    const p2 = ok(await api('GET', '/api/dashboard/plan', { token: other.token }))
    assert.equal(p2.basis, 'no_history', 'another user history does not leak into this plan')
  })

  test('ai-status reports the model state (ready / unreachable) without failing', async () => {
    reset()
    const c = await register('status1')
    const up = ok(await api('GET', '/api/dashboard/ai-status', { token: c.token }))
    assert.equal(up.state, 'ready'); assert.equal(up.model, 'qwen3:4b'); assert.match(up.advisory, /advisory/i)
    fake.down = true
    const down = ok(await api('GET', '/api/dashboard/ai-status', { token: c.token }))
    assert.equal(down.state, 'unreachable'); assert.match(down.fallback, /rule-based/)
  })

  test('cleanup of the problems created by this file', async () => {
    for (const id of created.problems) await pool.query('DELETE FROM coding_problems WHERE id = $1', [id])
  })
}
