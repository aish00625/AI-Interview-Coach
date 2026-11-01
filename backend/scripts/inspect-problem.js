#!/usr/bin/env node
/**
 * READ-ONLY diagnostic. Prints how a coding problem and its stored tests look in YOUR database, so a judge/test-data
 * mismatch can be diagnosed. Runs one SELECT. Writes nothing. Prints no secrets.
 *   node scripts/inspect-problem.js "two sum"        (title is matched case-insensitively, partial match)
 * Output goes to your terminal only; hidden tests are shown here because you own the database. They are never sent to the browser.
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const { pool } = require('../config/db')

const q = process.argv[2]
if (!q) { console.error('Usage: node scripts/inspect-problem.js "<part of the problem title>"'); process.exit(1) }
const show = (s) => JSON.stringify(String(s ?? ''))

;(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, slug, difficulty, description, test_cases FROM coding_problems WHERE title ILIKE $1 ORDER BY id`, [`%${q}%`])
    if (!rows.length) { console.log(`No problem with a title like "${q}".`); return }
    for (const p of rows) {
      const tests = Array.isArray(p.test_cases) ? p.test_cases : []
      console.log(`\n=== problem ${p.id}: ${p.title} (slug: ${p.slug || 'none - created by hand'}, ${p.difficulty}) ===`)
      console.log('Description:\n' + String(p.description || '').slice(0, 1500))
      console.log(`\n${tests.length} stored tests (${tests.filter((t) => t.is_hidden).length} hidden):`)
      tests.forEach((t, i) => {
        const input = String(t.input ?? '')
        const lines = input.split('\n')
        console.log(`\n#${i + 1} ${t.is_hidden ? 'HIDDEN' : 'visible'}`)
        console.log('  input (first 300 chars, JSON-quoted so \\n and \\r show): ' + show(input.slice(0, 300)) + (input.length > 300 ? ` ... (${input.length} chars)` : ''))
        console.log('  expected_output: ' + show(String(t.expected_output ?? '').slice(0, 300)))
        console.log(`  input lines: ${lines.filter((l) => l.length).length}; contains \\r: ${input.includes('\r')}; expected contains \\r: ${String(t.expected_output ?? '').includes('\r')}`)
      })
    }
  } catch (err) { console.error('Inspect failed:', err.message); process.exitCode = 1 } finally { await pool.end() }
})()
