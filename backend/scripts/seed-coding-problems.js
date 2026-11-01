#!/usr/bin/env node
/**
 * Loads the coding-problem bank into PostgreSQL. Idempotent and non-destructive:
 *   node scripts/seed-coding-problems.js             # insert problems whose slug is not in the database yet; leave existing ones alone
 *   node scripts/seed-coding-problems.js --dry-run   # validate and print the plan; no database access
 *   node scripts/seed-coding-problems.js --update    # also refresh text, hints and tests of problems already seeded (matched by slug)
 * Requires migration 007. Problems you created yourself (no slug) are never touched. Reference solutions are never stored.
 * WARNING for --update: changing the tests of a problem that a job assessment already uses changes how later attempts are graded.
 */
try { require('dotenv').config() } catch { /* dotenv is optional for these scripts; DATABASE_URL may come from the environment */ }
const { loadProblemBank, validateProblem } = require('../utils/problemBank')
const { seedProblems } = require('../utils/problemSeeder')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run'); const update = args.includes('--update')

async function main() {
  const problems = loadProblemBank()
  const invalid = problems.map((p) => ({ slug: p.slug, errors: validateProblem(p) })).filter((r) => r.errors.length)
  if (invalid.length) { invalid.forEach((r) => console.error(`Invalid problem ${r.slug}:\n  - ${r.errors.join('\n  - ')}`)); process.exit(1) }
  if (dryRun) { console.log(`Dry run: ${problems.length} valid problems would be considered:`); problems.forEach((p) => console.log(`  ${p.difficulty.padEnd(6)} ${p.slug} (${p.tests.length} tests, ${p.tests.filter((t) => !t.is_hidden).length} visible)`)); return }

  const { pool } = require('../config/db')
  try {
    const r = await seedProblems(pool, problems, { update })
    console.log(`Coding problems: ${r.inserted} inserted, ${r.updated} updated, ${r.skipped} already present (left unchanged).`)
  } catch (err) {
    console.error(`Seeding failed and was rolled back: ${err.message}`); process.exitCode = 1
  } finally { await pool.end() }
}
main().catch((err) => { console.error(err.message); process.exit(1) })
