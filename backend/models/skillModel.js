const { pool } = require('../config/db')
const { canonicalSkillName } = require('../utils/skillSynonyms')

/** Read/write access to the `skills` lookup table. */

async function getAllSkills() {
  const { rows } = await pool.query('SELECT id, name FROM skills ORDER BY name')
  return rows
}

async function findSkillById(id) {
  const { rows } = await pool.query('SELECT id, name FROM skills WHERE id = $1', [id])
  return rows[0] || null
}

async function findSkillByName(name) {
  const { rows } = await pool.query('SELECT id, name FROM skills WHERE name = $1', [name])
  return rows[0] || null
}

/**
 * Resolves each name to a skills row, creating it if needed. Names are canonicalised first ("ReactJS" -> "React",
 * "postgres" -> "PostgreSQL") and matched case-insensitively against existing rows, so one real-world skill is one row.
 * Returns one entry per input name, in the same order (two spellings of the same skill return the same row).
 * `client` defaults to the pool but accepts a transaction client too.
 */
async function findOrCreateSkillsByNames(names, client = pool) {
  const skills = []
  for (const raw of names) {
    const name = canonicalSkillName(raw)
    const existing = await client.query(
      'SELECT id, name FROM skills WHERE lower(name) = lower($1) ORDER BY (name = $1) DESC, id LIMIT 1',
      [name],
    )
    if (existing.rows[0]) { skills.push(existing.rows[0]); continue }
    const { rows } = await client.query(
      `INSERT INTO skills (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [name],
    )
    skills.push(rows[0])
  }
  return skills
}

module.exports = { getAllSkills, findSkillById, findSkillByName, findOrCreateSkillsByNames }
