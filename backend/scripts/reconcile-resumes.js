#!/usr/bin/env node
/**
 * Lists (default) or removes (--delete) resume files that have no database row.
 *   node scripts/reconcile-resumes.js            # dry run: report only
 *   node scripts/reconcile-resumes.js --delete   # remove orphan files older than --min-age-minutes (default 60)
 * Files referenced by a database row are never touched, and nothing is deleted from the database.
 */
try { require('dotenv').config() } catch { /* dotenv is optional for these scripts; DATABASE_URL may come from the environment */ }
const { pool } = require('../config/db')
const { reconcile, removeOrphans } = require('../utils/resumeReconcile')

async function main() {
  const args = process.argv.slice(2)
  const del = args.includes('--delete')
  const ageArg = args.find((a) => a.startsWith('--min-age-minutes='))
  const minAgeMs = ageArg ? Math.max(0, Number(ageArg.split('=')[1])) * 60 * 1000 : 60 * 60 * 1000
  const r = await reconcile(pool, { minAgeMs })
  console.log(`Files on disk: ${r.fileCount}   Rows in database: ${r.rowCount}`)
  console.log(`Orphan files (no row, old enough): ${r.orphans.length}`)
  r.orphans.forEach((k) => console.log(`  orphan  ${k}`))
  if (r.tooRecentToJudge.length) console.log(`Skipped ${r.tooRecentToJudge.length} recent file(s) (may belong to an upload in progress).`)
  console.log(`Rows whose file is missing on disk: ${r.missing.length}`)
  r.missing.forEach((k) => console.log(`  missing ${k}   (restore from backup; not deleted)`))
  if (del && r.orphans.length) console.log(`Removed ${await removeOrphans(r.orphans)} orphan file(s).`)
  else if (r.orphans.length) console.log('Dry run: re-run with --delete to remove the orphan files listed above.')
}

main().catch((err) => { console.error('Reconcile failed:', err.message); process.exitCode = 1 }).finally(() => pool.end())
