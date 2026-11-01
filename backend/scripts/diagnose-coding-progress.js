#!/usr/bin/env node
/**
 * READ-ONLY check of the coding "solved" status. Changes nothing; prints no source code, test data, emails or secrets.
 *   node scripts/diagnose-coding-progress.js            # every candidate that has practice submissions
 *   node scripts/diagnose-coding-progress.js --user 3   # one user id
 * Shows (1) the id types the two endpoints' queries really return (the cause of "Not started"), (2) per user how many
 * distinct problems are solved by the same rule the API uses, and (3) the latest submissions for Two Sum and Rotate Array.
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const { pool } = require('../config/db')
const codingModel = require('../models/codingModel')

;(async () => {
  try {
    const only = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null
    const problems = await codingModel.getAllProblems({})
    console.log(`Problems in the bank: ${problems.length}`)
    console.log(`  GET /coding/problems id type : ${typeof problems[0]?.id}   (e.g. ${JSON.stringify(problems[0]?.id)})`)
    const { rows: users } = await pool.query(
      `SELECT user_id, count(*)::int AS submissions,
              count(*) FILTER (WHERE status = 'passed')::int AS passed_rows,
              count(DISTINCT problem_id) FILTER (WHERE status = 'passed' AND application_id IS NULL)::int AS distinct_solved,
              count(*) FILTER (WHERE application_id IS NOT NULL)::int AS assessment_rows,
              count(*) FILTER (WHERE status = 'pending')::int AS pending_rows
         FROM coding_submissions ${only ? 'WHERE user_id = $1' : ''} GROUP BY user_id ORDER BY user_id`, only ? [only] : [])
    if (!users.length) console.log('No coding submissions found.')
    for (const u of users) {
      const progress = await codingModel.getProgressByProblem(u.user_id)
      const solvedByApi = progress.filter((p) => p.status === 'solved')
      const matched = problems.filter((p) => solvedByApi.some((s) => String(s.problemId) === String(p.id))).length
      const matchedOldWay = new Map(progress.map((p) => [p.problemId, p])); const oldWay = problems.filter((p) => matchedOldWay.get(p.id)?.status === 'solved').length
      console.log(`\nUser ${u.user_id}: ${u.submissions} submissions (${u.passed_rows} passed rows, ${u.pending_rows} still pending, ${u.assessment_rows} belong to a job assessment and are not practice)`)
      console.log(`  distinct problems solved (what the page should show): ${u.distinct_solved}`)
      console.log(`  GET /coding/progress problemId type: ${typeof progress[0]?.problemId}; solved found by id as String: ${matched}; by raw Map lookup (old page code): ${oldWay}`)
    }
    const { rows: latest } = await pool.query(
      `SELECT cs.id, cs.user_id, cp.id AS problem_id, cp.title, cs.status, cs.test_cases_passed, cs.test_cases_total, cs.application_id, cs.submitted_at
         FROM coding_submissions cs JOIN coding_problems cp ON cp.id = cs.problem_id
        WHERE cp.title IN ('Two Sum', 'Rotate Array') ${only ? 'AND cs.user_id = $1' : ''} ORDER BY cs.submitted_at DESC LIMIT 10`, only ? [only] : [])
    console.log('\nLatest Two Sum / Rotate Array submissions:')
    latest.forEach((r) => console.log(`  #${r.id} user ${r.user_id} problem ${r.problem_id} ${r.title}: ${r.status} ${r.test_cases_passed}/${r.test_cases_total}${r.application_id ? ' (assessment)' : ''} at ${new Date(r.submitted_at).toISOString()}`))
  } catch (err) { console.error('Failed: ' + err.message); process.exitCode = 1 } finally { await pool.end() }
})()
