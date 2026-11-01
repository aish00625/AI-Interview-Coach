// Phase W: hirer assessments end to end through the REAL routes, guards, services and SQL against a DEDICATED test database
// (env AIC_TEST_DB). Code execution and the AI service are stubbed (see phaseJ/harness.js). Skipped without AIC_TEST_DB.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

if (!process.env.AIC_TEST_DB) { test('Phase W assessments', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const { setup } = require('../phaseJ/harness')
  const { root } = require('../phaseA/helpers')
  const H = setup('assess')
  const { api, ok, tag, pool } = H
  const S = {}
  const HIDDEN = `HIDDEN-SECRET-${tag}`
  const EXPLAIN = `EXPLAIN-SECRET-${tag}`
  const noSecrets = (body, label) => { const s = JSON.stringify(body); assert.ok(!s.includes(HIDDEN) && !s.includes(EXPLAIN) && !/correctKeys|correct_keys/.test(s), `${label} leaked an answer key or hidden test`) }
  // The AI service stub has no face-monitoring capability: make it report "unreachable" explicitly.
  const ai = require(path.join(root, 'services/aiServiceClient'))
  ai.getFaceMonitorCapabilities = async () => ({ reachable: false, reason: 'ai_service_unreachable' })

  test('setup: organization A with a job, three applicants (one without assessment consent), a coding problem with hidden tests', async () => {
    Object.assign(S, await H.hiringFixture())
    S.c1 = await H.candidateApplies(S.job, 'cand')
    S.c2 = await H.candidateApplies(S.job, 'noconsent', { consentAssessment: false })
    S.c3 = await H.candidateApplies(S.job, 'late')
    const { rows } = await pool.query(
      `INSERT INTO coding_problems (title, description, difficulty, examples, test_cases) VALUES ($1, 'Print 3.', 'easy', '[{"input":"1\\n","output":"3"}]', $2::jsonb) RETURNING id`,
      [`Three ${tag}`, JSON.stringify([{ input: '1\n', expected_output: '3', is_hidden: false }, { input: `${HIDDEN}\n`, expected_output: HIDDEN, is_hidden: true }, { input: '2\n', expected_output: '3', is_hidden: true }])],
    )
    S.problemId = rows[0].id
    S.other = await H.hiringFixture()
  })

  test('question bank: validated server-side, keys visible to the team that owns it only', async () => {
    const q = (body) => api('POST', '/api/hirer/question-bank', { token: S.owner.token, body })
    assert.equal((await q({ sectionKind: 'aptitude', category: 'numerical', questionText: 'Bad one', choices: ['1', '2', '3'], correctKeys: ['A'] })).status, 400)
    S.q1 = ok(await q({ sectionKind: 'aptitude', category: 'numerical', questionText: 'What is 2+2?', choices: ['3', '4', '5', '6'], correctKeys: ['B'], marks: 2, explanation: EXPLAIN }), 201).question
    S.q2 = ok(await q({ sectionKind: 'aptitude', category: 'logical', questionType: 'multiple', questionText: 'Pick the even numbers', choices: ['2', '3', '4', '5'], correctKeys: ['A', 'C'], marks: 2 }), 201).question
    S.q3 = ok(await q({ sectionKind: 'technical', category: 'dbms', questionText: 'Which is a DDL command?', choices: ['SELECT', 'CREATE', 'INSERT', 'UPDATE'], correctKeys: ['B'], marks: 1 }), 201).question
    const mine = ok(await api('GET', '/api/hirer/question-bank', { token: S.owner.token }))
    assert.equal(mine.questions.length, 3); assert.deepEqual(mine.questions[0].correctKeys.length > 0, true)
    assert.equal(ok(await api('GET', '/api/hirer/question-bank', { token: S.other.owner.token })).questions.length, 0, 'organization isolation')
    assert.equal((await api('PUT', `/api/hirer/question-bank/${S.q1.id}`, { token: S.other.owner.token, body: { ...S.q1, choices: S.q1.choices.map((c) => c.text) } })).status, 404)
  })

  const definition = (patch = {}) => ({
    jobId: S.job.id, title: `Screen ${tag}`, instructions: 'Answer every section. The timer is set by the server.', durationMinutes: 60, maxAttempts: 1, passPercent: 60,
    sections: [
      { kind: 'aptitude', allowBack: false, negativeMarking: 0.25, items: [{ mcqQuestionId: S.q1.id }, { mcqQuestionId: S.q2.id }] },
      { kind: 'technical', items: [{ mcqQuestionId: S.q3.id }] },
      { kind: 'coding', items: [{ codingProblemId: S.problemId, marks: 10 }] },
    ],
    ...patch,
  })

  test('builder: drafts are validated, publish is refused until complete, published assessments are frozen', async () => {
    assert.equal((await api('POST', '/api/hirer/assessments', { token: S.owner.token, body: definition({ sections: [{ kind: 'technical', items: [{ mcqQuestionId: S.q1.id }] }] }) })).status, 400, 'aptitude question in the technical section')
    assert.equal((await api('POST', '/api/hirer/assessments', { token: S.owner.token, body: definition({ jobId: S.other.job.id }) })).status, 400, 'job of another organization')
    const empty = ok(await api('POST', '/api/hirer/assessments', { token: S.owner.token, body: definition({ instructions: '', sections: [] }) }), 201)
    assert.ok(empty.publishProblems.length >= 2)
    assert.equal((await api('POST', `/api/hirer/assessments/${empty.assessment.id}/publish`, { token: S.owner.token })).status, 422)
    const d = ok(await api('POST', '/api/hirer/assessments', { token: S.owner.token, body: definition() }), 201)
    assert.deepEqual(d.publishProblems, []); assert.equal(d.totalMarks, 15); assert.equal(d.editable, true)
    S.aid = d.assessment.id
    assert.equal((await api('POST', `/api/hirer/assessments/${S.aid}/invitations`, { token: S.owner.token, body: { applicationIds: [S.c1.app.id] } })).status, 409, 'cannot invite to a draft')
    const preview = ok(await api('GET', `/api/hirer/assessments/${S.aid}/preview`, { token: S.owner.token }))
    noSecrets(preview, 'preview'); assert.equal(preview.sections.length, 3)
    ok(await api('POST', `/api/hirer/assessments/${S.aid}/publish`, { token: S.owner.token }))
    assert.equal((await api('PUT', `/api/hirer/assessments/${S.aid}`, { token: S.owner.token, body: definition({ title: 'Changed' }) })).status, 409)
  })

  test('organization isolation and reviewer assignment', async () => {
    for (const [m, p] of [['GET', `/api/hirer/assessments/${S.aid}`], ['GET', `/api/hirer/assessments/${S.aid}/candidates`], ['POST', `/api/hirer/assessments/${S.aid}/close`]]) {
      assert.equal((await api(m, p, { token: S.other.owner.token })).status, 404, `${m} ${p}`)
    }
    const inv = ok(await api('POST', '/api/hirer/team/invitations', { token: S.owner.token, body: { email: `assessrev${tag}@j.test`, memberRole: 'reviewer' } }), 201)
    S.reviewer = ok(await api('POST', '/api/auth/register', { body: { name: 'Rev User', email: `assessrev${tag}@j.test`, password: 'password123', role: 'hirer', inviteToken: inv.inviteToken } }), 201)
    assert.equal(ok(await api('GET', '/api/hirer/assessments', { token: S.reviewer.token })).assessments.length, 0, 'not assigned yet')
    assert.equal((await api('GET', `/api/hirer/assessments/${S.aid}`, { token: S.reviewer.token })).status, 404)
    assert.equal((await api('POST', '/api/hirer/assessments', { token: S.reviewer.token, body: definition() })).status, 403, 'reviewers cannot build')
    assert.equal((await api('GET', '/api/hirer/question-bank', { token: S.reviewer.token })).status, 403, 'reviewers cannot read the answer-key bank')
    assert.equal((await api('PUT', `/api/hirer/assessments/${S.aid}/reviewers`, { token: S.owner.token, body: { userIds: [S.other.owner.user.id] } })).status, 400, 'must be a team member')
    ok(await api('PUT', `/api/hirer/assessments/${S.aid}/reviewers`, { token: S.owner.token, body: { userIds: [S.reviewer.user.id] } }))
    assert.equal(ok(await api('GET', '/api/hirer/assessments', { token: S.reviewer.token })).assessments.length, 1)
  })

  test('invitations: only active applicants of this job who consented; candidates see only their own', async () => {
    const r = ok(await api('POST', `/api/hirer/assessments/${S.aid}/invitations`, { token: S.owner.token, body: { applicationIds: [S.c1.app.id, S.c2.app.id, S.c3.app.id, 999999999] } }))
    assert.deepEqual(r.invited.map((x) => x.applicationId).sort(), [S.c1.app.id, S.c3.app.id].sort())
    assert.deepEqual(r.skipped.map((x) => x.reason).sort(), ['no_assessment_consent', 'not_an_applicant_for_this_job'])
    const list = ok(await api('GET', '/api/assessments', { token: S.c1.token }))
    assert.equal(list.invitations.length, 1); assert.equal(list.invitations[0].canStart, true)
    S.inv1 = list.invitations[0].invitationId
    S.inv3 = ok(await api('GET', '/api/assessments', { token: S.c3.token })).invitations[0].invitationId
    assert.equal((await api('GET', `/api/assessments/invitations/${S.inv1}`, { token: S.c3.token })).status, 404, "another candidate's invitation")
    assert.equal(ok(await api('GET', '/api/assessments', { token: S.c2.token })).invitations.length, 0)
    const detail = ok(await api('GET', `/api/assessments/invitations/${S.inv1}`, { token: S.c1.token }))
    assert.ok(detail.monitoringNotice.notes.some((n) => /never changes your score/i.test(n)))
    assert.equal((await api('GET', '/api/hirer/assessments', { token: S.c1.token })).status, 403, 'candidates cannot reach hirer routes')
    assert.equal((await api('GET', '/api/assessments', { token: S.owner.token })).status, 403, 'hirers cannot reach candidate routes')
  })

  test('consent is enforced; simultaneous starts create exactly one attempt', async () => {
    assert.equal((await api('POST', `/api/assessments/invitations/${S.inv1}/start`, { token: S.c1.token, body: { acceptTerms: false, monitoring: 'camera' } })).status, 400)
    assert.equal((await api('POST', `/api/assessments/invitations/${S.inv1}/start`, { token: S.c1.token, body: { acceptTerms: true } })).status, 400, 'monitoring choice required when enabled')
    const both = await Promise.all([1, 2].map(() => api('POST', `/api/assessments/invitations/${S.inv1}/start`, { token: S.c1.token, body: { acceptTerms: true, monitoring: 'alternative', accommodationNote: 'No webcam on this laptop.' } })))
    const ids = both.filter((r) => r.status === 200).map((r) => r.body.data.attemptId)
    assert.ok(ids.length >= 1 && both.every((r) => r.status === 200 || r.status === 409))
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM assessment_attempts WHERE invitation_id = $1', [S.inv1])
    assert.equal(rows[0].n, 1)
    S.att1 = ids[0]
  })

  test('sections: items only after entering; autosave; no keys in any response; no-going-back is enforced by the server', async () => {
    const st = ok(await api('GET', `/api/assessments/attempts/${S.att1}`, { token: S.c1.token }))
    assert.equal(st.sections.length, 3); assert.ok(st.sections.every((s) => s.items.length === 0), 'nothing readable before entering')
    const [apt, tech, cod] = st.sections
    const entered = ok(await api('POST', `/api/assessments/attempts/${S.att1}/sections/${apt.id}/enter`, { token: S.c1.token }))
    noSecrets(entered, 'attempt state')
    const items = entered.sections[0].items
    const byText = (t) => items.find((i) => i.question.questionText.includes(t)).id
    S.i1 = byText('2+2'); S.i2 = byText('even')
    assert.equal((await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i1}`, { token: S.c1.token, body: { selectedKeys: ['A', 'B'] } })).status, 400, 'single answer')
    ok(await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i1}`, { token: S.c1.token, body: { selectedKeys: ['B'] } }))
    ok(await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i2}`, { token: S.c1.token, body: { selectedKeys: ['A', 'Z'] } }))
    const again = ok(await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i2}`, { token: S.c1.token, body: { selectedKeys: ['A'] } }))
    assert.deepEqual(again.selectedKeys, ['A'], 'autosave overwrites; unknown keys dropped')
    assert.equal((await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i1}`, { token: S.c3.token, body: { selectedKeys: ['B'] } })).status, 404, "another candidate's attempt")
    const t2 = ok(await api('POST', `/api/assessments/attempts/${S.att1}/sections/${tech.id}/enter`, { token: S.c1.token }))
    assert.equal(t2.sections[0].locked, true)
    assert.equal((await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i1}`, { token: S.c1.token, body: { selectedKeys: ['C'] } })).status, 409, 'locked section')
    assert.equal((await api('POST', `/api/assessments/attempts/${S.att1}/sections/${apt.id}/enter`, { token: S.c1.token })).status, 409)
    ok(await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${t2.sections[1].items[0].id}`, { token: S.c1.token, body: { selectedKeys: ['B'] } }))
    S.codSection = cod.id
  })

  test('coding: runs through the executor (stubbed), only pass/fail per test index reaches the candidate', async () => {
    const c = ok(await api('POST', `/api/assessments/attempts/${S.att1}/sections/${S.codSection}/enter`, { token: S.c1.token }))
    const itemId = c.sections[2].items[0].id
    noSecrets(c, 'coding section')
    const first = ok(await api('POST', `/api/assessments/attempts/${S.att1}/coding/${itemId}`, { token: S.c1.token, body: { language: 'python', sourceCode: 'print(3)' } }))
    assert.equal(first.passedTests, 1); noSecrets(first, 'coding result')
    const best = ok(await api('POST', `/api/assessments/attempts/${S.att1}/coding/${itemId}`, { token: S.c1.token, body: { language: 'python', sourceCode: 'print(3) # SOLVED' } }))
    assert.equal(best.status, 'passed')
    assert.equal((await api('POST', `/api/assessments/attempts/${S.att1}/monitoring`, { token: S.c1.token })).status, 409, 'the alternative was chosen')
  })

  test('submission: scored by the server, idempotent, nothing can be changed afterwards; no automatic decision', async () => {
    const done = ok(await api('POST', `/api/assessments/attempts/${S.att1}/submit`, { token: S.c1.token }))
    assert.equal(done.status, 'submitted'); assert.equal(done.alreadySubmitted, false); noSecrets(done, 'confirmation')
    assert.equal(JSON.stringify(done).includes('totalScore'), false, 'the candidate confirmation has no score')
    const twice = ok(await api('POST', `/api/assessments/attempts/${S.att1}/submit`, { token: S.c1.token }))
    assert.equal(twice.alreadySubmitted, true)
    assert.equal((await api('PUT', `/api/assessments/attempts/${S.att1}/answers/${S.i1}`, { token: S.c1.token, body: { selectedKeys: ['A'] } })).status, 409)
    const { rows } = await pool.query('SELECT status FROM applications WHERE id = $1', [S.c1.app.id])
    assert.equal(rows[0].status, 'submitted', 'the application status is never changed by an assessment result')
  })

  test('hirer results: per-section scores, keys after submission, monitoring kept separate, audit written, reviewer notes', async () => {
    const list = ok(await api('GET', `/api/hirer/assessments/${S.aid}/attempts`, { token: S.owner.token }))
    const row = list.attempts.find((a) => a.id === S.att1)
    // aptitude: q1 right (+2), q2 wrong with 0.25 negative marking (-0.5) => 1.5 / 4; technical 1/1; coding 10/10
    assert.deepEqual(row.sectionScores, { aptitude: { score: 1.5, max: 4 }, technical: { score: 1, max: 1 }, coding: { score: 10, max: 10 } })
    assert.equal(row.totalScore, 12.5); assert.equal(row.maxScore, 15); assert.equal(row.meetsPassMark, true)
    const before = (await pool.query("SELECT count(*)::int AS n FROM access_audit_log WHERE action = 'assessment_view' AND application_id = $1", [S.c1.app.id])).rows[0].n
    const d = ok(await api('GET', `/api/hirer/assessments/attempts/${S.att1}`, { token: S.reviewer.token }))
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM access_audit_log WHERE action = 'assessment_view' AND application_id = $1", [S.c1.app.id])).rows[0].n, before + 1)
    assert.deepEqual(d.sections.aptitude.find((q) => q.itemId === S.i1).correctKeys, ['B'])
    assert.equal(d.sections.aptitude.find((q) => q.itemId === S.i1).explanation, EXPLAIN)
    assert.equal(d.sections.coding[0].best.testsPassed, 3)
    assert.equal(d.monitoring.choice, 'alternative'); assert.equal(d.monitoring.notAScore, true); assert.match(d.monitoring.summary, /accommodation/)
    assert.equal(JSON.stringify(d.overview).match(/monitor/i), null, 'the overview (scores) has no monitoring fields')
    ok(await api('POST', `/api/hirer/assessments/attempts/${S.att1}/notes`, { token: S.reviewer.token, body: { body: 'Solid DBMS basics.' } }))
    ok(await api('PATCH', `/api/hirer/assessments/attempts/${S.att1}/review-status`, { token: S.reviewer.token, body: { reviewStatus: 'reviewed' } }))
    assert.equal((await api('GET', `/api/hirer/assessments/attempts/${S.att1}`, { token: S.other.owner.token })).status, 404)
    assert.equal((await api('PUT', `/api/hirer/question-bank/${S.q1.id}`, { token: S.owner.token, body: { ...S.q1, choices: S.q1.choices.map((c) => c.text) } })).status, 409, 'questions used by an attempted assessment are frozen')
  })

  test('camera chosen but AI service unavailable: recorded as unavailable, the attempt continues; expiry closes it with saved answers', async () => {
    const s = ok(await api('POST', `/api/assessments/invitations/${S.inv3}/start`, { token: S.c3.token, body: { acceptTerms: true, monitoring: 'camera' } }))
    S.att3 = s.attemptId
    const m = await api('POST', `/api/assessments/attempts/${S.att3}/monitoring`, { token: S.c3.token })
    assert.equal(m.status, 503)
    const st = ok(await api('GET', `/api/assessments/attempts/${S.att3}`, { token: S.c3.token }))
    assert.equal(st.attempt.status, 'in_progress', 'monitoring failure never ends or penalises the attempt')
    ok(await api('POST', `/api/assessments/attempts/${S.att3}/sections/${st.sections[0].id}/enter`, { token: S.c3.token }))
    // a monitoring session linked to the attempt (as the AI service would have created) cannot be deleted by the candidate
    const fs = await pool.query(
      `INSERT INTO face_monitoring_sessions (user_id, consent_version, features, config, engine_state, retention_until, assessment_attempt_id, status, ended_at)
       VALUES ($1, 'assessment-x', '{}', '{}', '{}', now() + interval '30 days', $2, 'ended', now()) RETURNING id`, [S.c3.user.id, S.att3])
    assert.equal((await api('DELETE', `/api/face-monitoring/sessions/${fs.rows[0].id}`, { token: S.c3.token })).status, 409)
    await pool.query("UPDATE assessment_attempts SET deadline_at = now() - interval '1 minute' WHERE id = $1", [S.att3])
    const late = await api('PUT', `/api/assessments/attempts/${S.att3}/answers/${S.i1}`, { token: S.c3.token, body: { selectedKeys: ['B'] } })
    assert.equal(late.status, 409); assert.equal(late.body.reason, 'expired')
    const after = ok(await api('GET', `/api/assessments/attempts/${S.att3}`, { token: S.c3.token }))
    assert.equal(after.attempt.status, 'expired')
    const d = ok(await api('GET', `/api/hirer/assessments/attempts/${S.att3}`, { token: S.owner.token }))
    assert.ok(d.monitoring.issues.some((i) => i.issue === 'service_unavailable'))
    assert.equal(d.monitoring.available, true); assert.equal(d.overview.status, 'expired'); assert.equal(d.overview.totalScore, 0)
    const { rows } = await pool.query('SELECT status FROM applications WHERE id = $1', [S.c3.app.id])
    assert.equal(rows[0].status, 'submitted', 'no automatic rejection')
  })

  test('versioning: a new draft version copies the sections; the attempted version stays untouched', async () => {
    const v = ok(await api('POST', `/api/hirer/assessments/${S.aid}/versions`, { token: S.owner.token }), 201)
    assert.equal(v.assessment.version, 2); assert.equal(v.assessment.status, 'draft'); assert.equal(v.sections.length, 3); assert.equal(v.editable, true)
    ok(await api('PUT', `/api/hirer/assessments/${v.assessment.id}`, { token: S.owner.token, body: definition({ title: `Screen v2 ${tag}` }) }))
    const old = ok(await api('GET', `/api/hirer/assessments/${S.aid}`, { token: S.owner.token }))
    assert.equal(old.assessment.title, `Screen ${tag}`); assert.equal(old.hasAttempts, true)
    ok(await api('POST', `/api/hirer/assessments/${S.aid}/close`, { token: S.owner.token }))
  })
}
