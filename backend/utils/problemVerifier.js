const path = require('path')
const { runSolution, toolchains } = require('./solutionRunner')
const { validateProblem } = require('./problemBank')

/**
 * Verifies one problem:
 *   - structure (validateProblem)
 *   - reference.* and oracle.py must pass EVERY test           (the expected outputs are right, and independent programs agree)
 *   - wrong_*.py must FAIL at least one test                    (the tests are able to reject a plausible mistake)
 * Languages whose toolchain is missing are reported as "unavailable", never as passed. Python is required.
 */
function verifyProblem(problem, { runner = runSolution, only } = {}) {
  const errors = validateProblem(problem)
  const results = []
  for (const file of problem.solutions) {
    const base = path.basename(file)
    const role = /^wrong_/.test(base) ? 'wrong' : (/^oracle/.test(base) ? 'oracle' : 'reference')
    if (only && !only(base)) continue
    const r = runner(file, problem.tests)
    results.push({ ...r, base, role })
  }
  for (const r of results) {
    if (r.unavailable) { if (r.base === 'reference.py' || r.base === 'oracle.py') errors.push(`${r.base}: ${r.unavailable}`); continue }
    if (r.role !== 'wrong' && r.passed !== r.total) errors.push(`${r.base} fails ${r.total - r.passed}/${r.total} tests (${r.failures.slice(0, 3).map((f) => `#${f.index} ${f.reason}`).join('; ')})`)
    if (r.role === 'wrong' && r.passed === r.total) errors.push(`${r.base} passes every test: the tests cannot detect this mistake`)
  }
  return { slug: problem.slug, ok: errors.length === 0, errors, results }
}

module.exports = { verifyProblem, toolchains }
