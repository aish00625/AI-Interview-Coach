const { pool } = require('../config/db')

/**
 * `interview_sessions`, `interview_questions`, `interview_answers`.
 * Questions and answers stay in separate 1:1 tables (see database/schema.sql)
 * so a question can exist and be displayed before it has an answer.
 */

/* ---------------------------- Sessions ---------------------------- */

async function createSession({ userId, interviewType, targetRole, difficulty, applicationId = null }, client = pool) {
  // applicationId is NULL for ordinary private practice; set only for a hiring assessment (Phase D).
  const { rows } = await client.query(
    `INSERT INTO interview_sessions (user_id, interview_type, target_role, difficulty, application_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, interviewType, targetRole, difficulty, applicationId],
  )
  return rows[0]
}

async function getSessionById(id) {
  const { rows } = await pool.query('SELECT * FROM interview_sessions WHERE id = $1', [id])
  return rows[0] || null
}

/** Optional filters: { status, interviewType } — both optional, applied only if provided. */
async function getUserSessions(userId, { status, interviewType } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM interview_sessions
     WHERE user_id = $1
       AND application_id IS NULL -- hiring assessments are listed under the application, not in practice history
       AND ($2::text IS NULL OR status = $2)
       AND ($3::text IS NULL OR interview_type = $3)
     ORDER BY started_at DESC`,
    [userId, status ?? null, interviewType ?? null],
  )
  return rows
}

async function updateSessionStatus(id, status) {
  const { rows } = await pool.query(
    'UPDATE interview_sessions SET status = $2 WHERE id = $1 RETURNING *',
    [id, status],
  )
  return rows[0] || null
}

/** Marks a session completed: sets status, completed_at, and the calculated final_score together. */
async function updateFinalScore(id, finalScore, breakdown = null) {
  const { rows } = await pool.query(
    `UPDATE interview_sessions
     SET status = 'completed', completed_at = now(), final_score = $2, score_breakdown = $3::jsonb
     WHERE id = $1
     RETURNING *`,
    [id, finalScore, breakdown ? JSON.stringify(breakdown) : null],
  )
  return rows[0] || null
}

/* ---------------------------- Questions ---------------------------- */

async function createQuestion({ sessionId, topicId, questionText, orderIndex }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO interview_questions (session_id, topic_id, question_text, order_index)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [sessionId, topicId ?? null, questionText, orderIndex],
  )
  return rows[0]
}

/** Inserts a batch of questions (as returned by interviewQuestionService) for one session, in order. */
async function createQuestions(sessionId, questions, client = pool) {
  const created = []
  for (const q of questions) {
    created.push(await createQuestion({ sessionId, topicId: q.topicId, questionText: q.questionText, orderIndex: q.orderIndex }, client))
  }
  return created
}

async function getQuestionsBySession(sessionId) {
  const { rows } = await pool.query(
    `SELECT iq.*, t.name AS topic_name
     FROM interview_questions iq LEFT JOIN topics t ON t.id = iq.topic_id
     WHERE iq.session_id = $1 ORDER BY iq.order_index`,
    [sessionId],
  )
  return rows
}

async function getQuestionById(id) {
  const { rows } = await pool.query('SELECT * FROM interview_questions WHERE id = $1', [id])
  return rows[0] || null
}

/** True only if the question exists AND belongs to that session — used before accepting an answer. */
async function verifyQuestionBelongsToSession(questionId, sessionId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM interview_questions WHERE id = $1 AND session_id = $2',
    [questionId, sessionId],
  )
  return rows.length > 0
}

/* ---------------------------- Answers ---------------------------- */

/** Handles both text answers (answerText set) and voice answers (audioTranscript + speechMetrics set) — one INSERT, one code path, not two competing implementations. cv_metrics is never written here — Phase 11's visual analysis attaches it later, via updateAnswerEvaluation, once an answer already exists. */
async function createAnswer(fields, { replace = false } = {}) {
  const {
    questionId, answerText, audioTranscript, speechMetrics,
    technicalScore, relevanceScore, clarityScore, completenessScore,
    strengths, weaknesses, suggestedImprovement, modelAnswer, evaluationMeta, typingMetrics,
  } = fields

  const { rows } = await pool.query(
    `INSERT INTO interview_answers (
       question_id, answer_text, audio_transcript, speech_metrics,
       technical_score, relevance_score, clarity_score, completeness_score,
       strengths, weaknesses, suggested_improvement, model_answer, evaluation_meta, typing_metrics
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ${replace ? `ON CONFLICT (question_id) DO UPDATE SET
       answer_text = EXCLUDED.answer_text, audio_transcript = EXCLUDED.audio_transcript, speech_metrics = EXCLUDED.speech_metrics,
       technical_score = EXCLUDED.technical_score, relevance_score = EXCLUDED.relevance_score, clarity_score = EXCLUDED.clarity_score,
       completeness_score = EXCLUDED.completeness_score, strengths = EXCLUDED.strengths, weaknesses = EXCLUDED.weaknesses,
       suggested_improvement = EXCLUDED.suggested_improvement, model_answer = EXCLUDED.model_answer,
       evaluation_meta = EXCLUDED.evaluation_meta, typing_metrics = EXCLUDED.typing_metrics,
       cv_metrics = NULL, created_at = now()` : ''}
     RETURNING *`,
    [
      questionId, answerText ?? null, audioTranscript ?? null,
      speechMetrics ? JSON.stringify(speechMetrics) : null,
      technicalScore ?? null, relevanceScore ?? null, clarityScore ?? null, completenessScore ?? null,
      strengths ? JSON.stringify(strengths) : '[]',
      weaknesses ? JSON.stringify(weaknesses) : '[]',
      suggestedImprovement ?? null, modelAnswer ?? null,
      evaluationMeta ? JSON.stringify(evaluationMeta) : null,
      typingMetrics ? JSON.stringify(typingMetrics) : null,
    ],
  )
  return rows[0]
}

async function getAnswerByQuestion(questionId) {
  const { rows } = await pool.query('SELECT * FROM interview_answers WHERE question_id = $1', [questionId])
  return rows[0] || null
}

/** All answers for a session, joined with their question — used to build results and to compute the final score. */
async function getAnswersBySession(sessionId) {
  const { rows } = await pool.query(
    `SELECT ia.*, iq.question_text, iq.order_index, iq.topic_id
     FROM interview_answers ia
     JOIN interview_questions iq ON iq.id = ia.question_id
     WHERE iq.session_id = $1
     ORDER BY iq.order_index`,
    [sessionId],
  )
  return rows
}

/** Question ids in a session that already have an answer — used to find the next unanswered question. */
async function getAnsweredQuestionIds(sessionId) {
  const { rows } = await pool.query(
    `SELECT iq.id
     FROM interview_questions iq
     JOIN interview_answers ia ON ia.question_id = iq.id
     WHERE iq.session_id = $1`,
    [sessionId],
  )
  return rows.map((r) => r.id)
}

/** Still used by Phase 7 to attach real AI scores after the fact — kept even though Phase 6 sets scores at creation time via createAnswer. */
async function updateAnswerEvaluation(questionId, fields) {
  const {
    technicalScore, relevanceScore, clarityScore, completenessScore,
    strengths, weaknesses, suggestedImprovement, modelAnswer,
    speechMetrics, cvMetrics,
  } = fields

  const { rows } = await pool.query(
    `UPDATE interview_answers SET
       technical_score = COALESCE($2, technical_score),
       relevance_score = COALESCE($3, relevance_score),
       clarity_score = COALESCE($4, clarity_score),
       completeness_score = COALESCE($5, completeness_score),
       strengths = COALESCE($6, strengths),
       weaknesses = COALESCE($7, weaknesses),
       suggested_improvement = COALESCE($8, suggested_improvement),
       model_answer = COALESCE($9, model_answer),
       speech_metrics = COALESCE($10, speech_metrics),
       cv_metrics = COALESCE($11, cv_metrics)
     WHERE question_id = $1
     RETURNING *`,
    [
      questionId, technicalScore ?? null, relevanceScore ?? null, clarityScore ?? null,
      completenessScore ?? null,
      strengths ? JSON.stringify(strengths) : null,
      weaknesses ? JSON.stringify(weaknesses) : null,
      suggestedImprovement ?? null, modelAnswer ?? null,
      speechMetrics ? JSON.stringify(speechMetrics) : null,
      cvMetrics ? JSON.stringify(cvMetrics) : null,
    ],
  )
  return rows[0] || null
}

/** A re-attempt makes any saved STAR coaching for the question stale; it is advisory text only and is regenerated on request. */
async function deleteStarFeedback(userId, questionId) {
  await pool.query("DELETE FROM ai_feedback WHERE user_id = $1 AND kind = 'star' AND ref_id = $2", [userId, questionId])
}

module.exports = {
  deleteStarFeedback,
  createSession, getSessionById, getUserSessions, updateSessionStatus, updateFinalScore,
  createQuestion, createQuestions, getQuestionsBySession, getQuestionById, verifyQuestionBelongsToSession,
  createAnswer, getAnswerByQuestion, getAnswersBySession, getAnsweredQuestionIds, updateAnswerEvaluation,
}
