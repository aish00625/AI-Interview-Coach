#!/usr/bin/env node
/**
 * Verifies the seeded coding-problem bank.
 *
 *   node scripts/verify-coding-problems.js                 # local mode: runs the repository's trusted reference solutions
 *                                                          #   with the interpreters installed on this machine
 *   node scripts/verify-coding-problems.js --only=min-coins
 *   node scripts/verify-coding-problems.js --executor      # runs them through the REAL code executor (Docker) using
 *                                                          #   CODE_EXECUTOR_URL / CODE_EXECUTOR_API_KEY from .env
 *
 * Exit code 0 only if every problem verifies. A language whose toolchain is missing is reported as "n/a", never as passed.
 */
try { require('dotenv').config() } catch { /* dotenv is optional for these scripts; DATABASE_URL may come from the environment */ }
const path = require('path')
const { loadProblemBank } = require('../utils/problemBank')
const { verifyProblem, toolchains } = require('../utils/problemVerifier')
const { languageOf } = require('../utils/solutionRunner')

const args = process.argv.slice(2)
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1]
const useExecutor = args.includes('--executor')

async function executorRunner(file, tests) {
  const fs = require('fs')
  const codeExecutorClient = require('../services/codeExecutorClient')
  const language = languageOf(file)
  const testCases = tests.map((t) => ({ input: t.input, expectedOutput: t.expected_output }))
  try {
    const r = await codeExecutorClient.executeCode({ language, sourceCode: fs.readFileSync(file, 'utf8'), testCases })
    const passed = r.status === 'completed' ? r.passedTests : (r.passedTests || 0)
    return { file, lang: language, passed, total: tests.length, failures: passed === tests.length ? [] : [{ index: 0, reason: `executor status ${r.status}` }] }
  } catch (err) {
    return { file, unavailable: `executor unavailable: ${err.message}`, passed: 0, total: tests.length, failures: [] }
  }
}

async function main() {
  const problems = loadProblemBank().filter((p) => !only || p.slug === only)
  if (!problems.length) { console.error(`No problem matches "${only}".`); process.exit(2) }
  console.log(useExecutor ? 'Mode: REAL code executor (Docker)' : `Mode: local interpreters (${Object.keys(toolchains()).join(', ')})`)
  let bad = 0
  for (const p of problems) {
    let report
    if (useExecutor) {
      // verifyProblem is synchronous; pre-compute executor results, then feed them back through the same checks.
      const results = new Map()
      for (const f of p.solutions) {
        const base = path.basename(f)
        if (/^oracle/.test(base) || !languageOf(f)) continue
        results.set(f, await executorRunner(f, p.tests))
      }
      report = verifyProblem(p, { runner: (f, tests) => results.get(f) || { file: f, passed: tests.length, total: tests.length, failures: [], lang: 'python' }, only: (b) => !/^oracle/.test(b) })
    } else {
      report = verifyProblem(p)
    }
    const line = report.results.map((r) => `${r.base}:${r.unavailable ? 'n/a' : `${r.passed}/${r.total}`}`).join('  ')
    console.log(`${report.ok ? 'PASS' : 'FAIL'}  ${p.slug.padEnd(26)} ${line}`)
    for (const e of report.errors) console.log(`        - ${e}`)
    if (!report.ok) bad += 1
  }
  console.log(bad ? `\n${bad} of ${problems.length} problem(s) FAILED verification.` : `\nAll ${problems.length} problem(s) verified (${useExecutor ? 'via the real executor' : 'locally'}).`)
  process.exit(bad ? 1 : 0)
}
main().catch((err) => { console.error(err); process.exit(1) })
