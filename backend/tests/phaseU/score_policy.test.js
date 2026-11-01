// Scoring policy: skipped and not-evaluable answers are left out of per-dimension averages and topic averages (dashboard, knowledge-gap map,
// recommendations, previous-attempt comparison) but still count as 0 in the interview's final score. Real SQL against PostgreSQL (AIC_TEST_DB).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { stubModule, root } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('score policy real-DB tests', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db })
  test.after(async () => {
    // leave the shared test database exactly as found (other suites count topics)
    try {
      if (user) {
        await testPool.query(`DELETE FROM interview_answers WHERE question_id IN (SELECT q.id FROM interview_questions q JOIN interview_sessions s ON s.id = q.session_id WHERE s.user_id = $1)`, [user.id])
        await testPool.query(`DELETE FROM interview_questions WHERE session_id IN (SELECT id FROM interview_sessions WHERE user_id = $1)`, [user.id])
        await testPool.query(`DELETE FROM interview_sessions WHERE user_id = $1`, [user.id])
        await testPool.query(`DELETE FROM users WHERE id = $1`, [user.id])
      }
      if (topicId) await testPool.query(`DELETE FROM topics WHERE id = $1`, [topicId])
    } finally { testPool.closeAll() }
  })
  stubModule('config/db', { pool: testPool })
  const dashboard = require(path.join(root, 'models/dashboardModel.js'))
  const prepModel = require(path.join(root, 'models/preparationModel.js'))
  const insight = require(path.join(root, 'models/practiceInsightModel.js'))
  const prep = require(path.join(root, 'utils/preparation.js'))
  const { evaluatedAnswerSql, isEvaluatedAnswer } = require(path.join(root, 'utils/evaluatedAnswer.js'))
  const tag = Date.now()
  let user, onlySkip, mixed, topicId, topicName

  async function answer(sessionId, order, scores, meta) {
    const q = (await testPool.query(
      `INSERT INTO interview_questions (session_id, topic_id, question_text, order_index) VALUES ($1,$2,$3,$4) RETURNING id`,
      [sessionId, topicId, `q${order}`, order])).rows[0]
    await testPool.query(
      `INSERT INTO interview_answers (question_id, answer_text, technical_score, relevance_score, clarity_score, completeness_score, evaluation_meta)
       VALUES ($1,'x',$2,$2,$2,$2,$3::jsonb)`, [q.id, scores, meta ? JSON.stringify(meta) : null])
  }

  test('setup', async () => {
    user = (await testPool.query(`INSERT INTO users (email, password_hash, name) VALUES ('sp${tag}@t.test','x','SP') RETURNING id`)).rows[0]
    topicName = `ScorePolicy${tag}`
    topicId = (await testPool.query(`INSERT INTO topics (name) VALUES ($1) RETURNING id`, [topicName])).rows[0].id
    const mk = async () => (await testPool.query(
      `INSERT INTO interview_sessions (user_id, interview_type, target_role, difficulty, status) VALUES ($1,'technical','Dev','easy','in_progress') RETURNING id`, [user.id])).rows[0]
    onlySkip = await mk(); mixed = await mk()
  })

  test('helper: in-memory rule matches the SQL rule', () => {
    assert.equal(isEvaluatedAnswer({ evaluation_meta: null }), true)
    assert.equal(isEvaluatedAnswer({ evaluation_meta: { skipped: true } }), false)
    assert.equal(isEvaluatedAnswer({ evaluation_meta: { answerQuality: { status: 'not_evaluable' } } }), false)
    assert.equal(isEvaluatedAnswer({ evaluation_meta: { answerQuality: { status: 'partial' } } }), true)
    assert.match(evaluatedAnswerSql('x'), /x\.evaluation_meta/)
  })

  test('a topic with only skipped / not-evaluable answers has no average and is "insufficient data", never weak', async () => {
    await answer(onlySkip.id, 0, 0, { skipped: true, answerQuality: { status: 'skipped' } })
    await answer(onlySkip.id, 1, 0, { answerQuality: { status: 'not_evaluable' }, confidence: 'low' })
    const t = (await dashboard.getTopicPerformance(user.id)).find((x) => x.topic === topicName)
    assert.equal(t, undefined, 'no evaluated answer -> topic absent from the performance list instead of showing 0')
    assert.equal((await dashboard.getInterviewScoreAverages(user.id)).averageTechnicalScore, null)
    const stat = (await prepModel.getTopicStats(user.id)).find((x) => x.topic === topicName)
    assert.equal(stat.interviewAverage, null); assert.equal(stat.interviewAnswers, 0); assert.equal(stat.interviewUnscored, 2)
    const c = prep.classifyTopic(stat)
    assert.equal(c.status, 'insufficient_data'); assert.equal(c.score, null)
    assert.match(c.evidence, /skipped or could not be evaluated/)
    assert.equal((await insight.getTopicPerformance(user.id)).some((x) => x.topicName === topicName), false)
  })

  test('averages use evaluated answers only; skipped zeros do not drag a topic down', async () => {
    await answer(mixed.id, 0, 80, { answerQuality: { status: 'good' } })
    await answer(mixed.id, 1, 60, null) // legacy row without metadata counts as evaluated
    await answer(mixed.id, 2, 0, { skipped: true, answerQuality: { status: 'skipped' } })
    const avg = await dashboard.getInterviewScoreAverages(user.id)
    assert.equal(Number(avg.averageTechnicalScore), 70); assert.equal(Number(avg.averageClarityScore), 70)
    const t = (await dashboard.getTopicPerformance(user.id)).find((x) => x.topic === topicName)
    assert.equal(Number(t.averageScore), 70); assert.equal(t.answerCount, 2)
    const stat = (await prepModel.getTopicStats(user.id)).find((x) => x.topic === topicName)
    assert.equal(Number(stat.interviewAverage), 70); assert.equal(stat.interviewAnswers, 2); assert.equal(stat.interviewUnscored, 3) // 2 from the first session + 1 skipped here
    assert.equal(prep.classifyTopic(stat).status, 'strong')
    const ip = (await insight.getTopicPerformance(user.id)).find((x) => x.topicName === topicName)
    assert.equal(Number(ip.average), 70)
  })
}
