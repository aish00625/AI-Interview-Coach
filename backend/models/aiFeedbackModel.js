const { pool } = require('../config/db')

/** Saved advisory coaching text (table ai_feedback, migration 015): one row per (user, kind, ref), replaced on regenerate. */
const shape = (r) => r && ({ id: Number(r.id), kind: r.kind, refId: Number(r.ref_id), source: r.source, model: r.model, payload: r.payload, createdAt: r.created_at })

async function get(userId, kind, refId) {
  const { rows } = await pool.query('SELECT * FROM ai_feedback WHERE user_id = $1 AND kind = $2 AND ref_id = $3', [userId, kind, refId])
  return shape(rows[0] || null)
}

async function upsert(userId, kind, refId, { source, model, payload }) {
  const { rows } = await pool.query(
    `INSERT INTO ai_feedback (user_id, kind, ref_id, source, model, payload) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET source = EXCLUDED.source, model = EXCLUDED.model, payload = EXCLUDED.payload, created_at = now()
     RETURNING *`,
    [userId, kind, refId, source, model ?? null, JSON.stringify(payload)],
  )
  return shape(rows[0])
}

async function getTopicNames(ids) {
  const clean = [...new Set(ids.filter((i) => i != null))]
  if (!clean.length) return new Map()
  const { rows } = await pool.query('SELECT id, name FROM topics WHERE id = ANY($1::bigint[])', [clean])
  return new Map(rows.map((r) => [Number(r.id), r.name]))
}

module.exports = { get, upsert, getTopicNames }
