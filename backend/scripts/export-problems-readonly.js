#!/usr/bin/env node
/**
 * READ-ONLY export for an audit. Runs ONE SELECT on coding_problems (+ topic name) and writes a JSON file.
 * Changes nothing in the database. Prints no secrets. The file contains hidden tests, so keep it local: never commit,
 * upload or serve it.
 *   node scripts/export-problems-readonly.js            -> ../audit-export/problems.json
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const fs = require('fs'), path = require('path')
const { pool } = require('../config/db')

;(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.slug, p.difficulty, t.name AS topic, p.description, p.constraints, p.examples, p.hints, p.test_cases
         FROM coding_problems p LEFT JOIN topics t ON t.id = p.topic_id ORDER BY p.id`)
    const dir = path.join(__dirname, '..', '..', 'audit-export'); fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'problems.json')
    fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, problems: rows }, null, 1))
    console.log(`Exported ${rows.length} problems (${rows.reduce((n, r) => n + (Array.isArray(r.test_cases) ? r.test_cases.length : 0), 0)} tests) to ${file}`)
  } catch (err) { console.error('Export failed:', err.message); process.exitCode = 1 } finally { await pool.end() }
})()
