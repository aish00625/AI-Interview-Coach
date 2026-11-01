/**
 * Inserts (or with { update: true } refreshes) bank problems in a transaction. Matches by `slug` only, so problems an
 * admin created by hand (slug NULL) are never touched. Takes a pg-style pool so it can be tested against a scratch database.
 */
async function seedProblems(pool, problems, { update = false } = {}) {
  const client = await pool.connect()
  const out = { inserted: 0, updated: 0, skipped: 0 }
  try {
    await client.query('BEGIN')
    const col = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'coding_problems' AND column_name = 'slug'")
    if (!col.rows.length) throw new Error('coding_problems.slug is missing: run database/migrations/007_coding_problem_content.sql first.')
    for (const p of problems) {
      const topic = await client.query('SELECT id FROM topics WHERE name = $1', [p.topic])
      if (!topic.rows.length) throw new Error(`Topic "${p.topic}" does not exist in the topics table.`)
      const values = [topic.rows[0].id, p.title, p.description, p.difficulty, p.constraints, JSON.stringify(p.examples), JSON.stringify(p.tests), JSON.stringify(p.hints), p.slug]
      const existing = await client.query('SELECT id FROM coding_problems WHERE slug = $1', [p.slug])
      if (!existing.rows.length) {
        await client.query(
          `INSERT INTO coding_problems (topic_id, title, description, difficulty, constraints, examples, test_cases, hints, slug)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`, values)
        out.inserted += 1
      } else if (update) {
        await client.query(
          `UPDATE coding_problems SET topic_id = $1, title = $2, description = $3, difficulty = $4, constraints = $5,
                  examples = $6::jsonb, test_cases = $7::jsonb, hints = $8::jsonb WHERE slug = $9`, values)
        out.updated += 1
      } else out.skipped += 1
    }
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally { client.release() }
}
module.exports = { seedProblems }
