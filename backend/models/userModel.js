const { pool } = require('../config/db')

/**
 * Raw `users` table operations. No password hashing or JWT logic here —
 * that's Phase 5. `createUser` exists for Phase 4 database testing and
 * for Phase 5 to call once real hashing is in place; nothing in this
 * phase wires it to a route.
 */

async function createUser({ email, passwordHash, name, role = 'candidate' }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, role, created_at`,
    [email, passwordHash, name, role],
  )
  return rows[0]
}

async function findUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
    [id],
  )
  return rows[0] || null
}

async function findUserByEmail(email) {
  // Includes password_hash — only for internal use (Phase 5 login check),
  // never returned directly to the client.
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  return rows[0] || null
}

async function updateUser(id, { name, email }) {
  const { rows } = await pool.query(
    `UPDATE users
     SET name = COALESCE($2, name),
         email = COALESCE($3, email)
     WHERE id = $1
     RETURNING id, email, name, created_at, updated_at`,
    [id, name ?? null, email ?? null],
  )
  return rows[0] || null
}

module.exports = { createUser, findUserById, findUserByEmail, updateUser }
