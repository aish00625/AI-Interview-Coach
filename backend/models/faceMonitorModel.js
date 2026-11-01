const { pool } = require('../config/db')

/**
 * Face-monitoring sessions and events (migration 017). Every read and write is scoped by user_id: a candidate can only
 * ever reach their own rows. `db` is the pool, or a client inside a transaction.
 */
const iso = (v) => (v == null ? null : new Date(v).toISOString())
const ms = (v) => (v == null ? null : new Date(v).getTime())

const shapeSession = (r) => r && ({
  id: Number(r.id), userId: Number(r.user_id), interviewSessionId: r.interview_session_id == null ? null : Number(r.interview_session_id),
  assessmentAttemptId: r.assessment_attempt_id == null ? null : Number(r.assessment_attempt_id),
  status: r.status, consentVersion: r.consent_version, consentedAt: iso(r.consented_at),
  identityConsent: !!r.identity_consent, identityStatus: r.identity_status, referenceKey: r.reference_key || null,
  features: r.features, config: r.config, engineState: r.engine_state, report: r.report || null,
  startedAt: iso(r.started_at), endedAt: iso(r.ended_at), pausedMs: Number(r.paused_ms || 0), retentionUntil: iso(r.retention_until),
})

const shapeEvent = (r) => r && ({
  id: Number(r.id), sessionId: Number(r.session_id), eventType: r.event_type, category: r.category, status: r.status,
  startedAt: iso(r.started_at), endedAt: iso(r.ended_at), durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
  confidence: r.confidence == null ? null : Number(r.confidence), explanation: r.explanation, evidence: r.evidence || null,
})

async function createSession(db, { userId, interviewSessionId, assessmentAttemptId = null, consentVersion, identityConsent, identityStatus, referenceKey, features, config, engineState, retentionDays }) {
  const { rows } = await db.query(
    `INSERT INTO face_monitoring_sessions
       (user_id, interview_session_id, consent_version, identity_consent, identity_status, reference_key, features, config, engine_state, retention_until, assessment_attempt_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb, now() + ($10::int * interval '1 day'), $11) RETURNING *`,
    [userId, interviewSessionId ?? null, consentVersion, !!identityConsent, identityStatus, referenceKey ?? null, JSON.stringify(features), JSON.stringify(config), JSON.stringify(engineState), retentionDays, assessmentAttemptId ?? null],
  )
  return shapeSession(rows[0])
}

async function getOwned(db, id, userId, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM face_monitoring_sessions WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, userId])
  return shapeSession(rows[0] || null)
}

async function getRunning(db, userId) {
  const { rows } = await db.query("SELECT * FROM face_monitoring_sessions WHERE user_id = $1 AND status IN ('active','paused') ORDER BY started_at DESC LIMIT 1", [userId])
  return shapeSession(rows[0] || null)
}

async function listForUser(db, userId, limit = 20) {
  const { rows } = await db.query(
    `SELECT id, status, started_at, ended_at, interview_session_id, assessment_attempt_id, identity_status, paused_ms, retention_until,
            (SELECT count(*) FROM face_monitoring_events e WHERE e.session_id = s.id AND e.category IN ('warning','review_recommended')) AS flags
     FROM face_monitoring_sessions s WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2`, [userId, limit])
  return rows.map((r) => ({
    id: Number(r.id), status: r.status, startedAt: iso(r.started_at), endedAt: iso(r.ended_at),
    interviewSessionId: r.interview_session_id == null ? null : Number(r.interview_session_id), identityStatus: r.identity_status,
    assessmentAttemptId: r.assessment_attempt_id == null ? null : Number(r.assessment_attempt_id),
    flags: Number(r.flags), retentionUntil: iso(r.retention_until),
  }))
}

async function saveState(db, id, userId, engineState, { status, pausedMsAdd, endedAt, report, identityStatus, clearReference } = {}) {
  const sets = ['engine_state = $3::jsonb']
  const params = [id, userId, JSON.stringify(engineState)]
  const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)) }
  if (status) add('status = ?', status)
  if (pausedMsAdd) add('paused_ms = paused_ms + ?', Math.max(0, Math.round(pausedMsAdd)))
  if (endedAt) add("ended_at = (to_timestamp(?::double precision / 1000.0))", endedAt)
  if (report) add('report = ?::jsonb', JSON.stringify(report))
  if (identityStatus) add('identity_status = ?', identityStatus)
  if (clearReference) sets.push('reference_key = NULL')
  const { rows } = await db.query(`UPDATE face_monitoring_sessions SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`, params)
  return shapeSession(rows[0] || null)
}

async function insertEvent(db, { sessionId, userId, eventType, category, status, startedAt, endedAt, durationMs, confidence, explanation, evidence }) {
  const { rows } = await db.query(
    `INSERT INTO face_monitoring_events (session_id, user_id, event_type, category, status, started_at, ended_at, duration_ms, confidence, explanation, evidence)
     VALUES ($1,$2,$3,$4,$5, to_timestamp($6::double precision / 1000.0), CASE WHEN $7::double precision IS NULL THEN NULL ELSE to_timestamp($7::double precision / 1000.0) END, $8, $9, $10, $11::jsonb) RETURNING *`,
    [sessionId, userId, eventType, category, status, startedAt, endedAt ?? null, durationMs ?? null, confidence ?? null, explanation, evidence ? JSON.stringify(evidence) : null],
  )
  return shapeEvent(rows[0])
}

async function updateEvent(db, id, sessionId, userId, { category, explanation, endedAt, durationMs, resolved }) {
  const sets = []
  const params = [id, sessionId, userId]
  const add = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)) }
  if (category) add('category = ?', category)
  if (explanation) add('explanation = ?', explanation)
  if (resolved) {
    sets.push("status = 'resolved'")
    if (endedAt != null) add('ended_at = (to_timestamp(?::double precision / 1000.0))', endedAt)
    if (durationMs != null) add('duration_ms = ?', Math.max(0, Math.round(durationMs)))
  }
  if (!sets.length) return null
  const { rows } = await db.query(`UPDATE face_monitoring_events SET ${sets.join(', ')} WHERE id = $1 AND session_id = $2 AND user_id = $3 RETURNING *`, params)
  return shapeEvent(rows[0] || null)
}

async function listEvents(db, sessionId, userId) {
  const { rows } = await db.query('SELECT * FROM face_monitoring_events WHERE session_id = $1 AND user_id = $2 ORDER BY started_at, id', [sessionId, userId])
  return rows.map(shapeEvent)
}

async function deleteOwned(db, id, userId) {
  const { rows } = await db.query('DELETE FROM face_monitoring_sessions WHERE id = $1 AND user_id = $2 RETURNING reference_key', [id, userId])
  return rows[0] ? { referenceKey: rows[0].reference_key || null } : null
}

/** Retention: removes sessions (and, by cascade, events) past retention_until. */
async function purgeExpired(db) {
  const { rows } = await db.query('DELETE FROM face_monitoring_sessions WHERE retention_until < now() RETURNING reference_key')
  return rows.map((r) => r.reference_key).filter(Boolean)
}

/**
 * Sessions and events linked to one assessment attempt (migration 018). NOT user-scoped: callers must first authorize the
 * request (the hiring team of the attempt's organization, or the attempt's own candidate).
 */
async function listForAttempt(db, attemptId) {
  const { rows: sessions } = await db.query('SELECT * FROM face_monitoring_sessions WHERE assessment_attempt_id = $1 ORDER BY started_at', [attemptId])
  if (!sessions.length) return { sessions: [], events: [] }
  const { rows: events } = await db.query('SELECT * FROM face_monitoring_events WHERE session_id = ANY($1::bigint[]) ORDER BY started_at, id', [sessions.map((s) => s.id)])
  return { sessions: sessions.map(shapeSession), events: events.map(shapeEvent) }
}

module.exports = { createSession, getOwned, getRunning, listForUser, saveState, insertEvent, updateEvent, listEvents, deleteOwned, purgeExpired, listForAttempt, shapeSession, shapeEvent, ms }
