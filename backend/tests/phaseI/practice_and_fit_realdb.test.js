// Phase I against real PostgreSQL: skill canonicalisation, resume skill suggestions, job-fit authorization,
// personalised/adaptive practice, and the rule that hiring assessments are NEVER personalised or adapted.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase I practice/fit', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(() => testPool.closeAll())
  stubModule('config/db', { pool: testPool })
  let nextEval = null
  stubModule(path.join(root, 'services/aiServiceClient'), {
    evaluateAnswer: async () => nextEval,
  })
  const userModel = require(path.join(root, 'models/userModel.js'))
  const orgModel = require(path.join(root, 'models/organizationModel.js'))
  const jobService = require(path.join(root, 'services/jobService.js'))
  const resumeModel = require(path.join(root, 'models/resumeModel.js'))
  const applicationModel = require(path.join(root, 'models/applicationModel.js'))
  const profileService = require(path.join(root, 'services/profileService.js'))
  const interviewService = require(path.join(root, 'services/interviewService.js'))
  const interviewModel = require(path.join(root, 'models/interviewModel.js'))
  const skillInsight = require(path.join(root, 'services/skillInsightService.js'))
  const questionService = require(path.join(root, 'services/interviewQuestionService.js'))
  const insight = require(path.join(root, 'models/practiceInsightModel.js'))
  const tag = Date.now(); const ctx = {}

  const mkUser = (label) => userModel.createUser({ email: `${label}${tag}@t.com`, passwordHash: 'h', name: label })
  const mkResume = (userId, text, name = 'cv.pdf') => resumeModel.insertResume({ userId, originalFilename: name, contentType: 'application/pdf', sizeBytes: 10, storageKey: `k${tag}${Math.random()}`, extractedText: text, extractionStatus: text ? 'ok' : 'unsupported' })
  const goodEval = (extra = {}) => ({ technicalScore: 40, relevanceScore: 40, clarityScore: 70, completenessScore: 40, strengths: ['s'], weaknesses: ['w'], suggestedImprovement: 'i', modelAnswer: 'm',
    evaluationMeta: { confidence: 'medium', confidenceNote: 'n', rubricId: 'r', rubricKind: 'concept', matchedCriteria: [], missingCriteria: ['x'] }, followUps: ['What about X?', 'And Y?'], ...extra })

  test('setup', async () => {
    ctx.cand = await mkUser('pf1'); ctx.other = await mkUser('pf2')
    const h = await userModel.createUser({ email: `pfh${tag}@t.com`, passwordHash: 'h', name: 'h', role: 'hirer' })
    ctx.org = await orgModel.createOrganization({ name: `PF ${tag}`, createdBy: h.id })
    await orgModel.addMember({ organizationId: ctx.org.id, userId: h.id })
    await orgModel.setOrganizationStatus({ id: ctx.org.id, status: 'approved', reviewedBy: h.id })
    ctx.hirer = h
  })

  test('skills: spellings collapse to one canonical row across profiles and jobs (and nothing duplicates)', async () => {
    const { skills } = await profileService.upsertProfileWithSkills(ctx.cand.id, { skillNames: ['ReactJS', 'react', 'postgres', 'Postgres', 'Custom Tool'] })
    assert.deepEqual(skills.map((s) => s.name).sort(), ['Custom Tool', 'PostgreSQL', 'React'])
    const job = await jobService.createJob({ organizationId: ctx.org.id, userId: ctx.hirer.id, body: { title: `Fit ${tag}`, description: 'd', requiredSkills: ['reactjs', 'React', { name: 'sql', mandatory: false }, 'Node'] } })
    ctx.job = await jobService.changeStatus({ organizationId: ctx.org.id, jobId: job.id, status: 'open' })
    const names = ctx.job.required_skills.map((s) => s.name).sort()
    assert.deepEqual(names, ['Node.js', 'React', 'SQL'])
    const reactJob = ctx.job.required_skills.find((s) => s.name === 'React').id
    assert.equal(String(reactJob), String(skills.find((s) => s.name === 'React').id), 'profile and job point at the same skills row')
    assert.equal((await testPool.query("SELECT count(*)::int n FROM skills WHERE lower(name) IN ('reactjs','node','postgres')")).rows[0].n, 0, 'alias spellings are never stored')
    assert.equal((await testPool.query("SELECT count(*)::int n FROM skills WHERE lower(name) = 'react'")).rows[0].n, 1)
    assert.equal(ctx.job.required_skills.find((s) => s.name === 'SQL').mandatory, false)
  })

  test('skills: an existing legacy lower-case row is reused instead of creating a case-variant duplicate', async () => {
    await testPool.query("INSERT INTO skills (name) VALUES ($1)", [`legacy${tag}`])
    const { skills } = await profileService.upsertProfileWithSkills(ctx.other.id, { skillNames: [`LEGACY${tag}`] })
    assert.equal(skills[0].name, `legacy${tag}`)
    assert.equal((await testPool.query('SELECT count(*)::int n FROM skills WHERE lower(name) = lower($1)', [`legacy${tag}`])).rows[0].n, 1)
  })

  test('resume skill suggestions: owner only, flags skills already on the profile, honest when no text', async () => {
    const r = await mkResume(ctx.cand.id, 'Skills: React, Node.js, Postgres, Docker. Built REST APIs.')
    const s = await skillInsight.suggestFromResume({ userId: ctx.cand.id, resumeId: r.id })
    assert.equal(s.available, true)
    const by = Object.fromEntries(s.suggestions.map((x) => [x.name, x.inProfile]))
    assert.equal(by.React, true); assert.equal(by.PostgreSQL, true); assert.equal(by.Docker, false); assert.equal(by['Node.js'], false)
    await assert.rejects(skillInsight.suggestFromResume({ userId: ctx.other.id, resumeId: r.id }), { statusCode: 404 })
    const blank = await mkResume(ctx.cand.id, null)
    const n = await skillInsight.suggestFromResume({ userId: ctx.cand.id, resumeId: blank.id })
    assert.equal(n.available, false); assert.match(n.reason, /No text could be read/)
    assert.equal((await testPool.query('SELECT count(*)::int n FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.user_id = $1 AND s.name = $2', [ctx.cand.id, 'Docker'])).rows[0].n, 0, 'suggestions are never saved automatically')
    ctx.resume = r
  })

  test('job fit: explains matches with evidence; resume must be yours; only open jobs; nothing stored', async () => {
    const fit = await skillInsight.jobFit({ userId: ctx.cand.id, jobId: ctx.job.id, resumeId: ctx.resume.id })
    const by = Object.fromEntries(fit.skills.map((x) => [x.name, x]))
    assert.equal(by.React.status, 'matched'); assert.equal(by.React.source, 'both')
    assert.equal(by['Node.js'].status, 'matched'); assert.equal(by['Node.js'].source, 'resume'); assert.match(by['Node.js'].evidence, /not on your profile/)
    assert.equal(by.SQL.status, 'missing'); assert.equal(by.SQL.mandatory, false)
    assert.equal(fit.summary.matched, 2); assert.equal(fit.summary.requiredTotal, 3)
    assert.ok(fit.nextSteps.some((n) => /SQL/.test(n) && /practice questions/.test(n)), 'points at available practice')
    const profileOnly = await skillInsight.jobFit({ userId: ctx.cand.id, jobId: ctx.job.id })
    assert.equal(profileOnly.summary.matched, 1)
    await assert.rejects(skillInsight.jobFit({ userId: ctx.other.id, jobId: ctx.job.id, resumeId: ctx.resume.id }), { statusCode: 404 })
    const draft = await jobService.createJob({ organizationId: ctx.org.id, userId: ctx.hirer.id, body: { title: 'Draft', description: 'd', requiredSkills: ['Java'] } })
    await assert.rejects(skillInsight.jobFit({ userId: ctx.cand.id, jobId: draft.id }), { statusCode: 404 })
  })

  async function finishPractice(userId, score, type = 'technical') {
    const { session } = await interviewService.createInterviewSession({ userId, interviewType: type, targetRole: 'Dev', difficulty: 'medium' })
    await testPool.query("UPDATE interview_sessions SET status = 'completed', final_score = $2, completed_at = now() WHERE id = $1", [session.id, score])
    return session
  }

  test('personalised practice: questions follow skills/role; reasons are returned; assessment-pool questions are not required', async () => {
    const { questions, personalization } = await interviewService.createInterviewSession({ userId: ctx.cand.id, interviewType: 'technical', targetRole: 'Frontend Developer', difficulty: 'medium', personalize: true })
    assert.equal(questions.length, 5)
    assert.ok(questions.some((q) => /React/.test(q.question_text)), 'a React question for a React candidate')
    assert.equal(personalization.personalized, true); assert.equal(personalization.adaptive, false)
    assert.equal(personalization.questionReasons.length, 5); assert.ok(personalization.questionReasons.every((r) => r.reasons.length >= 1))
    assert.ok(personalization.questionReasons.some((r) => r.reasons.some((x) => /Matches your skill/.test(x))))
    const repeat = await interviewService.createInterviewSession({ userId: ctx.cand.id, interviewType: 'technical', targetRole: 'Frontend Developer', difficulty: 'medium', personalize: true })
    const first = new Set(questions.map((q) => q.question_text))
    const overlap = repeat.questions.filter((q) => first.has(q.question_text)).length
    assert.ok(overlap <= 2, `a second session avoids most of the first session's questions (overlap ${overlap})`)
  })

  test('without the options a practice session is exactly the original deterministic selection', async () => {
    const plain = await interviewService.createInterviewSession({ userId: ctx.other.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })
    const legacy = await questionService.generateInterviewQuestions({ interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })
    assert.deepEqual(plain.questions.map((q) => q.question_text), legacy.map((q) => q.questionText))
    assert.equal(plain.personalization, undefined)
  })

  test('adaptive difficulty: needs history, uses only same-type completed PRACTICE sessions, and is stored on the session', async () => {
    const u = await mkUser('adapt')
    let r = await interviewService.createInterviewSession({ userId: u.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'medium', adaptive: true })
    assert.equal(r.session.difficulty, 'medium'); assert.match(r.personalization.difficultyReason, /at least 2/)
    await finishPractice(u.id, 90); await finishPractice(u.id, 84)
    await finishPractice(u.id, 5, 'hr') // a different type must not drag the average down
    r = await interviewService.createInterviewSession({ userId: u.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'medium', adaptive: true })
    assert.equal(r.session.difficulty, 'hard'); assert.equal(r.personalization.difficultyRequested, 'medium'); assert.match(r.personalization.difficultyReason, /averaged 87\/100/)
    r = await interviewService.createInterviewSession({ userId: u.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'medium' })
    assert.equal(r.session.difficulty, 'medium', 'without adaptive the chosen difficulty is always honoured')
  })

  test('HIRING ASSESSMENTS ignore personalise/adaptive: every applicant gets identical questions and difficulty', async () => {
    const job = await jobService.createJob({ organizationId: ctx.org.id, userId: ctx.hirer.id, body: { title: `Assess ${tag}`, description: 'd', requiredSkills: ['Java'] } })
    const open = await jobService.changeStatus({ organizationId: ctx.org.id, jobId: job.id, status: 'open' })
    const apps = []
    for (const u of [ctx.cand, ctx.other]) {
      const r = await mkResume(u.id, 'x')
      const id = await applicationModel.insertApplication({ consentResume: true, consentAssessment: true, jobId: open.id, candidateId: u.id, resumeId: r.id })
      await applicationModel.addHistory({ applicationId: id, toStatus: 'submitted', changedBy: u.id })
      apps.push(id)
    }
    // ctx.cand has React skills + practice history that WOULD change a personalised session; the flags must be ignored anyway.
    const a = await interviewService.createInterviewSession({ userId: ctx.cand.id, interviewType: 'technical', targetRole: 'Assess', difficulty: 'medium', applicationId: apps[0], personalize: true, adaptive: true })
    const b = await interviewService.createInterviewSession({ userId: ctx.other.id, interviewType: 'technical', targetRole: 'Assess', difficulty: 'medium', applicationId: apps[1] })
    const texts = (x) => x.questions.map((q) => q.question_text)
    assert.deepEqual(texts(a), texts(b))
    assert.equal(a.session.difficulty, 'medium'); assert.equal(a.personalization, undefined)
    const legacy = await questionService.generateInterviewQuestions({ interviewType: 'technical', targetRole: 'x', difficulty: 'medium' })
    assert.deepEqual(texts(a), legacy.map((q) => q.questionText), 'identical to the original selection, unaffected by the larger practice bank')
    ctx.assessSession = a.session; ctx.practiceSession = (await interviewService.createInterviewSession({ userId: ctx.cand.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'easy' })).session
  })

  test('follow-up prompts are kept for practice answers and dropped for hiring-assessment answers', async () => {
    nextEval = goodEval()
    const practiceQs = await interviewModel.getQuestionsBySession(ctx.practiceSession.id)
    const p = await interviewService.submitAnswer({ sessionId: ctx.practiceSession.id, userId: ctx.cand.id, questionId: practiceQs[0].id, answerText: 'an answer' })
    assert.deepEqual(p.answer.evaluation_meta.followUps, ['What about X?', 'And Y?'])
    assert.equal(p.answer.evaluation_meta.confidence, 'medium')
    const assessQs = await interviewModel.getQuestionsBySession(ctx.assessSession.id)
    const a = await interviewService.submitAnswer({ sessionId: ctx.assessSession.id, userId: ctx.cand.id, questionId: assessQs[0].id, answerText: 'an answer' })
    assert.equal(a.answer.evaluation_meta.followUps, undefined)
    assert.equal(a.answer.evaluation_meta.confidence, 'medium', 'confidence is kept: it is honesty metadata, not coaching')
    nextEval = goodEval({ evaluationMeta: null, followUps: ['ignored'] })
    const none = await interviewService.submitAnswer({ sessionId: ctx.practiceSession.id, userId: ctx.cand.id, questionId: practiceQs[1].id, answerText: 'another' })
    assert.equal(none.answer.evaluation_meta, null, 'an older AI service without metadata still works')
  })

  test('practice insight: weak topics come from the user\'s PRACTICE answers only', async () => {
    const u = await mkUser('weak')
    const topicId = (await testPool.query("SELECT id FROM topics WHERE name = 'Graphs'")).rows[0].id
    const mkAnswered = async (appId, score) => {
      const s = (await testPool.query("INSERT INTO interview_sessions (user_id, interview_type, target_role, difficulty, application_id) VALUES ($1,'technical','R','easy',$2) RETURNING id", [u.id, appId])).rows[0].id
      const q = (await testPool.query("INSERT INTO interview_questions (session_id, topic_id, question_text, order_index) VALUES ($1,$2,'q',1) RETURNING id", [s, topicId])).rows[0].id
      await testPool.query("INSERT INTO interview_answers (question_id, answer_text, technical_score) VALUES ($1,'a',$2)", [q, score])
    }
    await mkAnswered(null, 30)
    await mkAnswered(null, 50)
    const perf = await insight.getTopicPerformance(u.id)
    assert.deepEqual(perf.map((p) => [p.topicName, Math.round(p.average)]), [['Graphs', 40]])
    const none = await insight.getTopicPerformance((await mkUser('nohist')).id)
    assert.deepEqual(none, [])
    const { questions, personalization } = await interviewService.createInterviewSession({ userId: u.id, interviewType: 'technical', targetRole: 'Dev', difficulty: 'medium', personalize: true })
    assert.ok(questions.some((q) => /BFS and DFS/.test(q.question_text)), 'the Graphs question is chosen for a candidate who is weak at Graphs')
    assert.ok(personalization.questionReasons.some((r) => r.reasons.some((x) => /weaker topic: Graphs.*40\/100/.test(x))))
  })
}
