const { pool } = require('../config/db')

/**
 * Follow-up turns of a practice interview (table interview_followups, migration 015). Deliberately separate from
 * interview_answers: nothing here is scored or feeds analytics. Every read takes the caller's session id after the
 * service has verified ownership.
 */
const shape = (r) => r && ({
  id: Number(r.id), sessionId: Number(r.session_id), questionId: Number(r.question_id), turnNo: r.turn_no,
  prompt: r.prompt, source: r.source, model: r.model, reason: r.reason, status: r.status,
  answerText: r.answer_text, feedback: r.feedback || null, createdAt: r.created_at, answeredAt: r.answered_at,
})

async function listForQuestion(questionId) {
  const { rows } = await pool.query('SELECT * FROM interview_followups WHERE question_id = $1 ORDER BY turn_no', [questionId])
  return rows.map(shape)
}

async function listForSession(sessionId) {
  const { rows } = await pool.query('SELECT * FROM interview_followups WHERE session_id = $1 ORDER BY question_id, turn_no', [sessionId])
  return rows.map(shape)
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM interview_followups WHERE id = $1', [id])
  return shape(rows[0] || null)
}

/** Returns null (instead of throwing) if the same turn was created concurrently - the UNIQUE (question_id, turn_no) key decides. */
async function create({ sessionId, questionId, turnNo, prompt, source, model, reason }) {
  const { rows } = await pool.query(
    `INSERT INTO interview_followups (session_id, question_id, turn_no, prompt, source, model, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (question_id, turn_no) DO NOTHING RETURNING *`,
    [sessionId, questionId, turnNo, prompt, source, model ?? null, reason ?? null],
  )
  return shape(rows[0] || null)
}

/** Only an OPEN turn can be answered; the WHERE clause makes a double submit a no-op. */
async function markAnswered(id, answerText, feedback) {
  const { rows } = await pool.query(
    `UPDATE interview_followups SET status = 'answered', answer_text = $2, feedback = $3, answered_at = now()
      WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, answerText, feedback ? JSON.stringify(feedback) : null],
  )
  return shape(rows[0] || null)
}

async function markSkipped(id) {
  const { rows } = await pool.query(`UPDATE interview_followups SET status = 'skipped', answered_at = now() WHERE id = $1 AND status = 'open' RETURNING *`, [id])
  return shape(rows[0] || null)
}

async function skipOpenForSession(sessionId) {
  await pool.query(`UPDATE interview_followups SET status = 'skipped', answered_at = now() WHERE session_id = $1 AND status = 'open'`, [sessionId])
}

module.exports = { listForQuestion, listForSession, getById, create, markAnswered, markSkipped, skipOpenForSession }
