const { pool } = require('../config/db')

/** Read access to the `topics` lookup table — seeded by schema.sql, never written to by the app. */

async function getAllTopics() {
  const { rows } = await pool.query('SELECT id, name FROM topics ORDER BY name')
  return rows
}

async function findTopicById(id) {
  const { rows } = await pool.query('SELECT id, name FROM topics WHERE id = $1', [id])
  return rows[0] || null
}

async function findTopicByName(name) {
  const { rows } = await pool.query('SELECT id, name FROM topics WHERE name = $1', [name])
  return rows[0] || null
}

module.exports = { getAllTopics, findTopicById, findTopicByName }
