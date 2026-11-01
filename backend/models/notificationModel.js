const { pool } = require('../config/db')

/** In-app notifications (Phase J). Reads and updates are always scoped by user_id. */

async function create({ userId, type, title, body, applicationId }, client = pool) {
  const { rows } = await client.query(
    'INSERT INTO notifications (user_id, type, title, body, application_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userId, type, title, body ?? null, applicationId ?? null],
  )
  return rows[0].id
}

async function listForUser({ userId, unreadOnly = false, limit = 30, before = null }) {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, application_id, read_at, created_at
       FROM notifications
      WHERE user_id = $1 AND ($2::boolean = FALSE OR read_at IS NULL) AND ($3::bigint IS NULL OR id < $3)
      ORDER BY id DESC LIMIT $4`,
    [userId, unreadOnly, before, limit],
  )
  return rows
}

async function unreadCount(userId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])
  return rows[0].n
}

async function markRead({ userId, id }) {
  const { rows } = await pool.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId],
  )
  return rows.length > 0
}

async function markAllRead(userId) {
  const { rowCount } = await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId])
  return rowCount
}

module.exports = { create, listForUser, unreadCount, markRead, markAllRead }
