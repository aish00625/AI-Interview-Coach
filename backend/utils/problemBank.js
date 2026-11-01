const fs = require('fs')
const path = require('path')

/**
 * The seeded coding-problem bank: backend/data/coding-problems/<slug>/{problem.json, tests.json, solutions/*}.
 *
 *   problem.json  statement, topic, difficulty, constraints, examples, three tiered hints  (stored in the database)
 *   tests.json    [{ input, expected_output, is_hidden }]                                  (stored in the database)
 *   solutions/    reference solutions, a brute-force oracle and deliberately wrong programs (NEVER stored or served;
 *                 used only by scripts/verify-coding-problems.js and the tests)
 */
const BANK_DIR = path.join(__dirname, '..', 'data', 'coding-problems')
const TOPICS = ['Arrays', 'Strings', 'Hashing', 'Linked Lists', 'Stack', 'Queue', 'Trees', 'Graphs', 'Recursion', 'Dynamic Programming', 'Sorting', 'Searching']
const DIFFICULTIES = ['easy', 'medium', 'hard']
const MAX_TESTS = 20            // the code executor runs at most MAX_TEST_CASES (20) per submission
const MAX_INPUT_CHARS = 30000
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

function loadProblemBank(dir = BANK_DIR) {
  const problems = []
  for (const slug of fs.readdirSync(dir).sort()) {
    const pdir = path.join(dir, slug)
    if (!fs.statSync(pdir).isDirectory()) continue
    const meta = JSON.parse(fs.readFileSync(path.join(pdir, 'problem.json'), 'utf8'))
    const tests = JSON.parse(fs.readFileSync(path.join(pdir, 'tests.json'), 'utf8'))
    const sdir = path.join(pdir, 'solutions')
    const solutions = fs.existsSync(sdir) ? fs.readdirSync(sdir).sort().map((f) => path.join(sdir, f)) : []
    problems.push({ ...meta, dirName: slug, tests, solutions })
  }
  return problems
}

const norm = (s) => String(s).trim()

/** Structural checks only (no code is run). Returns an array of human-readable problems; empty means valid. */
function validateProblem(p) {
  const e = []
  const need = (cond, msg) => { if (!cond) e.push(msg) }
  need(typeof p.slug === 'string' && SLUG.test(p.slug) && p.slug.length <= 80, 'slug must be lowercase words joined by hyphens (max 80)')
  need(p.slug === p.dirName, `slug "${p.slug}" must equal its directory name "${p.dirName}"`)
  need(typeof p.title === 'string' && p.title.trim().length >= 3 && p.title.length <= 200, 'title must be 3-200 characters')
  need(TOPICS.includes(p.topic), `topic must be one of the seeded topics (${TOPICS.join(', ')})`)
  need(DIFFICULTIES.includes(p.difficulty), 'difficulty must be easy, medium or hard')
  need(typeof p.description === 'string' && p.description.length >= 80 && /Input format/i.test(p.description) && /Output format/i.test(p.description), 'description must be at least 80 characters and include "Input format" and "Output format" sections')
  need(typeof p.constraints === 'string' && p.constraints.length > 0, 'constraints are required')
  need(Array.isArray(p.hints) && p.hints.length === 3 && p.hints.every((h) => typeof h === 'string' && h.trim().length >= 20), 'exactly three hints of at least 20 characters are required (nudge, approach, near-solution)')
  const tests = Array.isArray(p.tests) ? p.tests : []
  need(tests.length >= 8 && tests.length <= MAX_TESTS, `between 8 and ${MAX_TESTS} test cases are required (found ${tests.length})`)
  const visible = tests.filter((t) => t.is_hidden === false); const hidden = tests.filter((t) => t.is_hidden === true)
  need(visible.length >= 2, 'at least 2 visible tests are required')
  need(hidden.length >= 5, 'at least 5 hidden tests are required')
  need(visible.length + hidden.length === tests.length, 'every test needs a boolean is_hidden')
  const seen = new Set()
  tests.forEach((t, i) => {
    need(typeof t.input === 'string' && t.input.length > 0 && t.input.length <= MAX_INPUT_CHARS, `test ${i + 1}: input must be 1-${MAX_INPUT_CHARS} characters`)
    need(typeof t.expected_output === 'string' && t.expected_output === norm(t.expected_output) && t.expected_output.length > 0, `test ${i + 1}: expected_output must be non-empty and already trimmed`)
    need(!seen.has(t.input), `test ${i + 1}: duplicate input`); seen.add(t.input)
  })
  need(Array.isArray(p.examples) && p.examples.length >= 1, 'at least one example is required')
  for (const ex of p.examples || []) {
    need(visible.some((t) => t.input === ex.input && t.expected_output === norm(ex.output)), `example "${String(ex.input).slice(0, 20)}..." must also be a visible test with the same expected output`)
    need(typeof ex.explanation === 'string' && ex.explanation.length > 0, 'every example needs an explanation')
  }
  const names = p.solutions.map((f) => path.basename(f))
  need(names.includes('reference.py') && names.includes('oracle.py'), 'solutions/reference.py and solutions/oracle.py are required')
  need(names.some((n) => /^wrong_.*\.py$/.test(n)), 'at least one solutions/wrong_*.py (a plausible incorrect program the tests must reject) is required')
  return e
}

module.exports = { loadProblemBank, validateProblem, BANK_DIR, TOPICS, MAX_TESTS }
