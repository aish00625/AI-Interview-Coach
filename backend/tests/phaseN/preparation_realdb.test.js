// Phase N, REAL PostgreSQL + REAL route chains: preparation dashboard, weekly goals, interview comparison.
// Timestamps are inserted relative to now() so the review/streak/weekly rules are exercised with real data.
const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('../phaseJ/harness')

if (!process.env.AIC_TEST_DB) { test('Phase N preparation DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const H = setup('n')
  const { api, ok, pool, register, hiringFixture, candidateApplies, tag } = H
  const created = { problems: [], users: [] }

  const topicId = async (name) => (await pool.query('SELECT id FROM topics WHERE name = $1', [name])).rows[0].id
  const userId = async (reg) => reg.user.id
  async function session(uid, { status = 'completed', score = null, role = 'Backend', type = 'technical', completedDaysAgo = 0, applicationId = null } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO interview_sessions (user_id, interview_type, target_role, difficulty, status, final_score, started_at, completed_at, application_id)
       VALUES ($1,$2,$3,'medium',$4::text,$5, now() - make_interval(days => $6::int) - interval '5 minutes', CASE WHEN $4::text = 'completed' THEN now() - make_interval(days => $6::int) END, $7) RETURNING id`,
      [uid, type, role, status, score, completedDaysAgo, applicationId])
    return rows[0].id
  }
  let order = 0
  async function answer(sessionId, topic, { technical, clarity = null, daysAgo = 0 }) {
    const q = await pool.query('INSERT INTO interview_questions (session_id, topic_id, question_text, order_index) VALUES ($1,$2,$3,$4) RETURNING id', [sessionId, await topicId(topic), `Q about ${topic} ${tag}`, ++order])
    await pool.query(
      `INSERT INTO interview_answers (question_id, answer_text, technical_score, relevance_score, clarity_score, completeness_score, created_at)
       VALUES ($1,'an answer',$2,$2,$3,$2, now() - make_interval(days => $4::int))`, [q.rows[0].id, technical, clarity ?? technical, daysAgo])
  }
  async function problem(topic, difficulty, title) {
    const { rows } = await pool.query(
      `INSERT INTO coding_problems (topic_id, title, description, difficulty, test_cases) VALUES ($1,$2,'desc',$3,'[{"input":"1","expected_output":"SECRET-EXPECTED","is_hidden":true}]') RETURNING id`,
      [await topicId(topic), `${title} ${tag}`, difficulty])
    created.problems.push(rows[0].id)
    return rows[0].id
  }
  const submission = (uid, problemId, status, daysAgo, applicationId = null) => pool.query(
    `INSERT INTO coding_submissions (user_id, problem_id, language, source_code, test_cases_passed, test_cases_total, status, submitted_at, application_id)
     VALUES ($1,$2,'python','print(SECRET_SOURCE)',1,3,$3, now() - make_interval(days => $4::int), $5)`, [uid, problemId, status, daysAgo, applicationId])
  const prep = async (token) => ok(await api('GET', '/api/dashboard/preparation', { token }))

  test('access control: unauthenticated 401, hirer 403 on every new candidate route', async () => {
    assert.equal((await api('GET', '/api/dashboard/preparation')).status, 401)
    assert.equal((await api('PUT', '/api/dashboard/goals', { body: { weeklyInterviews: 1, weeklyProblems: 1 } })).status, 401)
    const hirer = await register('hirerN', { role: 'hirer', companyName: `Org ${tag}` })
    assert.equal((await api('GET', '/api/dashboard/preparation', { token: hirer.token })).status, 403)
    assert.equal((await api('PUT', '/api/dashboard/goals', { token: hirer.token, body: { weeklyInterviews: 1, weeklyProblems: 1 } })).status, 403)
    assert.equal((await api('GET', '/api/interviews/1/comparison', { token: hirer.token })).status, 403)
  })

  test('first-time candidate: honest empty state, no invented numbers', async () => {
    const c = await register('fresh')
    const d = await prep(c.token)
    assert.equal(d.hasAnyActivity, false)
    assert.equal(d.readiness.score, null)
    assert.match(d.readiness.reason, /Not enough practice data/)
    assert.equal(d.goals.current, null)
    assert.deepEqual(d.goals.progress, { interviews: 0, problems: 0 })
    assert.equal(d.heatmap.days.length, 84); assert.equal(d.heatmap.totalActions, 0)
    assert.deepEqual([d.streak.current, d.streak.longest], [0, 0])
    const topics = d.gapMap.subjects.flatMap((s) => s.topics)
    assert.equal(topics.length, 17); assert.ok(topics.every((t) => t.status === 'no_data' && t.score === null))
    assert.deepEqual(d.reviewQueue, []); assert.deepEqual(d.upcomingReviews, [])
    assert.deepEqual(d.nextSteps.map((s) => s.id).slice(0, 2), ['first-interview', 'first-problem'])
    assert.equal(d.overview.averageInterviewScore, null); assert.equal(d.overview.codingSuccessRate, null)
    assert.ok(d.methodology.length >= 4)
  })

  test('real practice data drives readiness, the gap map, spaced review, streak, heatmap and suggestions', async () => {
    const c = await register('active'); const uid = await userId(c)
    const s1 = await session(uid, { score: 70 })
    // Arrays: 3 answers (40,50,60 -> avg 50) five days ago. DBMS: 2 answers (90,95 -> 92.5) today.
    for (const t of [40, 50, 60]) await answer(s1, 'Arrays', { technical: t, daysAgo: 5 })
    for (const t of [90, 95]) await answer(s1, 'DBMS', { technical: t })
    const [a1, a2, a3, a4] = [await problem('Arrays', 'easy', 'A1'), await problem('Arrays', 'easy', 'A2'), await problem('Arrays', 'medium', 'A3'), await problem('Arrays', 'hard', 'A4')]
    const st1 = await problem('Strings', 'easy', 'S1')
    await submission(uid, a1, 'passed', 3); await submission(uid, a2, 'failed', 3); await submission(uid, a3, 'failed', 3)   // Arrays coding 1/3 solved, last on day -3
    await submission(uid, st1, 'passed', 0)                                                                               // Strings 1/1 solved today
    const live = await session(uid, { status: 'in_progress', role: 'Frontend' })

    const d = await prep(c.token)
    assert.equal(d.hasAnyActivity, true)
    assert.equal(d.overview.completedInterviews, 1); assert.equal(d.overview.averageInterviewScore, 70)
    assert.equal(d.overview.distinctProblemsAttempted, 4); assert.equal(d.overview.distinctProblemsSolved, 2)

    const topics = Object.fromEntries(d.gapMap.subjects.flatMap((s) => s.topics).map((t) => [t.topic, t]))
    // Arrays: interview avg 50 and coding 1/3 = 33.3 -> mean 41.67 -> 42 -> weak
    assert.deepEqual([topics.Arrays.status, topics.Arrays.score, topics.Arrays.interviewAnswers, topics.Arrays.codingAttempted, topics.Arrays.codingSolved], ['weak', 42, 3, 3, 1])
    assert.equal(topics.DBMS.status, 'strong'); assert.equal(topics.DBMS.score, 93)   // 92.5 rounds to 93
    assert.equal(topics.Strings.status, 'insufficient_data')                           // a single problem is not enough
    assert.equal(topics.Networking.status, 'no_data')

    // spaced review: Arrays weak -> 1-day interval, last practised 3 days ago -> due, overdue by 2 days; DBMS (14 days) is upcoming
    assert.equal(d.reviewQueue[0].topic, 'Arrays'); assert.equal(d.reviewQueue[0].isDue, true); assert.equal(d.reviewQueue[0].overdueDays, 2)
    assert.equal(d.reviewQueue[0].lastPracticedDaysAgo, 3)
    assert.ok(d.upcomingReviews.some((r) => r.topic === 'DBMS' && r.isDue === false && r.intervalDays === 14))

    // readiness = interview 70 (.4) + coding 2/4=50 (.3) + coverage 3 of 17 = 18 (.2) + consistency 3 active days = 43 (.1) = 28+15+3.6+4.3 = 50.9 -> 51
    assert.equal(d.readiness.score, 51); assert.equal(d.readiness.band, 'Building'); assert.equal(d.readiness.basedOn, 4)

    assert.deepEqual([d.streak.current, d.streak.longest, d.streak.activeDaysLast14], [1, 1, 3])
    assert.equal(d.heatmap.activeDays, 3); assert.equal(d.heatmap.totalActions, 9)   // 5 answers + 4 submissions

    // suggestions: Arrays is weak (1/3 solved) -> an EASY unsolved Arrays problem (A2); Strings is unexplored -> easy Strings problem not yet solved (none: S1 solved)
    const arraysPick = d.suggestedProblems.find((p) => p.topic === 'Arrays')
    assert.equal(arraysPick.id, a2); assert.equal(arraysPick.difficulty, 'easy'); assert.match(arraysPick.reason, /1 of 3 attempted problems solved/)
    assert.ok(![a1, st1].includes(arraysPick.id))                                     // never suggests something already solved
    assert.equal(d.continueInterview.id, live)
    assert.equal(d.nextSteps[0].type, 'continue'); assert.equal(d.nextSteps[0].link, `/interview/${live}`)
    assert.ok(d.nextSteps.some((s) => s.type === 'review' && /Arrays/.test(s.title)))
    assert.ok(d.nextSteps.length <= 5)
    // coding analytics are real counts
    const easy = d.coding.byDifficulty.find((x) => x.difficulty === 'easy')
    assert.ok(easy.solved >= 2 && easy.attempted >= 3)
    assert.deepEqual(d.coding.topicSuccess.find((t) => t.topic === 'Arrays'), { topic: 'Arrays', attempted: 3, solved: 1, rate: 33 })
    // nothing confidential in the payload
    const raw = JSON.stringify(d)
    for (const secret of ['SECRET-EXPECTED', 'SECRET_SOURCE', 'test_cases', 'expected_output', 'source_code', 'model_answer', 'password']) assert.ok(!raw.includes(secret), `payload leaked ${secret}`)
    void a4
  })

  test('weekly goals: validated, persisted per user, progress counted from real practice this week', async () => {
    const c = await register('goaler'); const uid = await userId(c)
    for (const bad of [{ weeklyInterviews: -1, weeklyProblems: 1 }, { weeklyInterviews: 51, weeklyProblems: 1 }, { weeklyInterviews: 1, weeklyProblems: 201 }, { weeklyInterviews: 2.5, weeklyProblems: 1 }, { weeklyInterviews: '3', weeklyProblems: 1 }, { weeklyProblems: 1 }, {}]) {
      assert.equal((await api('PUT', '/api/dashboard/goals', { token: c.token, body: bad })).status, 400, JSON.stringify(bad))
    }
    assert.equal((await prep(c.token)).goals.current, null)                              // nothing stored by failed attempts
    const saved = ok(await api('PUT', '/api/dashboard/goals', { token: c.token, body: { weeklyInterviews: 2, weeklyProblems: 3 } }))
    assert.deepEqual([saved.goals.weeklyInterviews, saved.goals.weeklyProblems], [2, 3])
    ok(await api('PUT', '/api/dashboard/goals', { token: c.token, body: { weeklyInterviews: 0, weeklyProblems: 0 } }))   // zero = "no goal" is allowed, and replaces the row
    ok(await api('PUT', '/api/dashboard/goals', { token: c.token, body: { weeklyInterviews: 2, weeklyProblems: 3 } }))
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_goals WHERE user_id = $1', [uid])).rows[0].n, 1)
    const sId = await session(uid, { score: 80 })                                         // finished just now: counts for this week
    await session(uid, { score: 80, completedDaysAgo: 30 })                               // a month ago: does not
    const p1 = await problem('Sorting', 'easy', 'G1'); const p2 = await problem('Sorting', 'easy', 'G2')
    await submission(uid, p1, 'passed', 0); await submission(uid, p1, 'passed', 0)        // same problem twice counts once
    await submission(uid, p2, 'failed', 0)                                                // failed does not count
    const d = await prep(c.token)
    assert.deepEqual(d.goals.current, { weeklyInterviews: 2, weeklyProblems: 3 })
    assert.deepEqual(d.goals.progress, { interviews: 1, problems: 1 })
    assert.ok(d.nextSteps.some((s) => s.type === 'goal' && /1 of 2 weekly interviews/.test(s.reason)))
    assert.ok(d.nextSteps.some((s) => s.type === 'goal' && /1 of 3 weekly problems/.test(s.reason)))
    void sId
    // goals are private to the user and appear in their own data export
    const other = await register('nogoal'); assert.equal((await prep(other.token)).goals.current, null)
    const exp = ok(await api('GET', '/api/account/export', { token: c.token }))
    assert.deepEqual([exp.candidate.weeklyGoals.weekly_interviews, exp.candidate.weeklyGoals.weekly_problems], [2, 3])
  })

  test('hiring-assessment activity and other users\' data never appear in a candidate\'s preparation view', async () => {
    const { owner, job } = await hiringFixture()
    const cand = await candidateApplies(job, 'assessed')
    const uid = cand.user.id
    const asSession = await session(uid, { score: 95, applicationId: cand.app.id })
    await answer(asSession, 'Arrays', { technical: 95 }); await answer(asSession, 'Arrays', { technical: 95 })
    const pr = await problem('Arrays', 'easy', 'AS1')
    await submission(uid, pr, 'passed', 0, cand.app.id)
    const d = await prep(cand.token)
    assert.equal(d.hasAnyActivity, false); assert.equal(d.overview.completedInterviews, 0); assert.equal(d.readiness.score, null)
    assert.equal(d.gapMap.subjects.flatMap((s) => s.topics).find((t) => t.topic === 'Arrays').status, 'no_data')
    assert.equal(d.heatmap.totalActions, 0)
    // another candidate cannot compare someone else's session
    const stranger = await register('stranger')
    assert.equal((await api('GET', `/api/interviews/${asSession}/comparison`, { token: stranger.token })).status, 404)
    assert.equal((await api('GET', `/api/interviews/${asSession}/comparison`, { token: cand.token })).status, 404)   // assessment sessions are not comparable
    void owner
  })

  test('previous-attempt comparison: same type and role, own completed practice sessions only', async () => {
    const c = await register('cmp'); const uid = await userId(c)
    const old = await session(uid, { score: 60, completedDaysAgo: 10, role: 'Backend Dev' })
    await answer(old, 'Arrays', { technical: 50, clarity: 40 }); await answer(old, 'DBMS', { technical: 70, clarity: 60 })
    const mid = await session(uid, { score: 65, completedDaysAgo: 5, role: 'Other Role' })      // different role: must be ignored
    await answer(mid, 'Arrays', { technical: 99 })
    const cur = await session(uid, { score: 72, completedDaysAgo: 0, role: 'backend dev' })     // role match is case-insensitive
    await answer(cur, 'Arrays', { technical: 70, clarity: 60 }); await answer(cur, 'Networking', { technical: 80, clarity: 80 })
    const live = await session(uid, { status: 'in_progress', role: 'Backend Dev' })

    const d = ok(await api('GET', `/api/interviews/${cur}/comparison`, { token: c.token }))
    assert.equal(d.available, true); assert.equal(d.previous.id, old); assert.equal(d.scoreChange, 12)
    const tech = d.dimensions.find((x) => x.dimension === 'technical'); const clar = d.dimensions.find((x) => x.dimension === 'clarity')
    assert.deepEqual([tech.current, tech.previous, tech.change], [75, 60, 15])               // (70+80)/2 vs (50+70)/2
    assert.deepEqual([clar.current, clar.previous, clar.change], [70, 50, 20])
    assert.deepEqual(d.topics, [{ topic: 'Arrays', current: 70, previous: 50, change: 20 }]) // only topics asked in both
    assert.match(d.note, /different questions/)

    const first = ok(await api('GET', `/api/interviews/${old}/comparison`, { token: c.token }))
    assert.equal(first.available, false); assert.match(first.reason, /first completed practice interview/)
    assert.equal((await api('GET', `/api/interviews/${live}/comparison`, { token: c.token })).status, 404)   // not completed
    assert.equal((await api('GET', '/api/interviews/999999999/comparison', { token: c.token })).status, 404)
    const raw = JSON.stringify(d)
    for (const secret of ['answer_text', 'model_answer', 'speech_metrics', 'typing_metrics', 'evaluation_meta']) assert.ok(!raw.includes(secret))
  })

  test('coding progress: own solved/attempted flags per problem, no code or tests, practice only', async () => {
    const c = await register('progress'); const uid = await userId(c)
    const [solvedP, triedP, untouched] = [await problem('Searching', 'easy', 'PR1'), await problem('Searching', 'medium', 'PR2'), await problem('Searching', 'hard', 'PR3')]
    await submission(uid, solvedP, 'failed', 2); await submission(uid, solvedP, 'passed', 1)
    await submission(uid, triedP, 'failed', 1); await submission(uid, triedP, 'error', 0)
    const other = await register('progress2'); await submission(other.user.id, untouched, 'passed', 0)       // someone else's solve must not show
    const { owner, job } = await hiringFixture(); const cand = await candidateApplies(job, 'prog')
    await submission(cand.user.id, untouched, 'passed', 0, cand.app.id)                                        // assessment attempt: excluded
    const mine = ok(await api('GET', '/api/coding/progress', { token: c.token })).progress
    assert.deepEqual(mine.map((p) => [p.problemId, p.status, p.attempts]), [[solvedP, 'solved', 2], [triedP, 'attempted', 2]])
    assert.equal(mine.find((p) => p.problemId === untouched), undefined)
    const raw = JSON.stringify(mine); for (const leak of ['source_code', 'SECRET', 'test_cases']) assert.ok(!raw.includes(leak))
    assert.deepEqual(ok(await api('GET', '/api/coding/progress', { token: cand.token })).progress, [])         // the applicant's assessment work is not "practice progress"
    assert.equal((await api('GET', '/api/coding/progress')).status, 401)
    assert.equal((await api('GET', '/api/coding/progress', { token: owner.token })).status, 403)
  })

  // Last test on purpose: remove only the problems this file created (submissions first: RESTRICT) so other suites' counts are unaffected.
  // (A test.after hook would run after the harness has already closed the pool.)
  test('cleanup of the problems created by this file', async () => {
    await pool.query('DELETE FROM coding_submissions WHERE problem_id = ANY($1::bigint[])', [created.problems])
    await pool.query('DELETE FROM coding_problems WHERE id = ANY($1::bigint[])', [created.problems])
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM coding_problems WHERE id = ANY($1::bigint[])', [created.problems])).rows[0].n, 0)
  })
}
