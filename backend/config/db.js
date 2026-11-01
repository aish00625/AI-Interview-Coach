const { Pool } = require('pg')

/**
 * PostgreSQL connection pool.
 *
 * Pool settings are deliberately modest for a student project running
 * locally — there's no need to tune these further unless you hit real
 * concurrency limits:
 *   - max: 10           max simultaneous clients checked out from the pool
 *   - idleTimeoutMillis: how long an unused client sits open before pg closes it
 *   - connectionTimeoutMillis: how long to wait for a new connection before failing
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  // Fires for errors on idle clients (e.g. the DB restarts) — logged here
  // so a background connection problem doesn't crash the whole process.
  console.error('Unexpected PostgreSQL pool error:', err.message)
})

/**
 * Lightweight connectivity probe for GET /api/health/db.
 * Never throws — callers get a boolean and, on failure, the error message.
 */
async function checkConnection() {
  try {
    await pool.query('SELECT 1')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { pool, checkConnection }
