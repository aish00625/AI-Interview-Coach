// Phase H: the seeded coding-problem bank is structurally valid and its tests are VERIFIED by running independent solutions.
// Uses the interpreters installed on the machine running the tests (Python and Node are required; Java and C++ are used when present).
// This does NOT exercise the Docker code executor.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { loadProblemBank, validateProblem, TOPICS } = require('../../utils/problemBank')
const { verifyProblem } = require('../../utils/problemVerifier')
const { toolchains } = require('../../utils/solutionRunner')

const bank = loadProblemBank()

test('the bank has 12-60 original problems with a sensible spread of difficulty and topics', () => {
  assert.ok(bank.length >= 12 && bank.length <= 60, `found ${bank.length}`)
  const by = (d) => bank.filter((p) => p.difficulty === d).length
  assert.ok(by('easy') >= 4 && by('medium') >= 4 && by('hard') >= 2, `easy ${by('easy')} medium ${by('medium')} hard ${by('hard')}`)
  assert.ok(new Set(bank.map((p) => p.topic)).size >= 6)
  assert.equal(new Set(bank.map((p) => p.slug)).size, bank.length)
  assert.equal(new Set(bank.map((p) => p.title)).size, bank.length)
  for (const p of bank) assert.ok(TOPICS.includes(p.topic), p.slug)
})

test('every problem passes structural validation (statement sections, 3 hints, 8-20 tests incl. visible and hidden, examples are visible tests)', () => {
  for (const p of bank) assert.deepEqual(validateProblem(p), [], p.slug)
})

test('structural validation rejects the mistakes it is meant to catch', () => {
  const base = bank[0]
  const bad = (patch) => validateProblem({ ...base, ...patch }).length > 0
  assert.ok(bad({ hints: base.hints.slice(0, 2) }), 'two hints')
  assert.ok(bad({ tests: base.tests.filter((t) => !t.is_hidden) }), 'no hidden tests')
  assert.ok(bad({ tests: base.tests.map((t) => ({ ...t, is_hidden: true })) }), 'no visible tests')
  assert.ok(bad({ tests: [...base.tests, base.tests[0]] }), 'duplicate input')
  assert.ok(bad({ tests: base.tests.map((t, i) => (i === 0 ? { ...t, expected_output: ` ${t.expected_output} ` } : t)) }), 'untrimmed expected output')
  assert.ok(bad({ examples: [{ input: 'nope', output: '1', explanation: 'x' }] }), 'example that is not a visible test')
  assert.ok(bad({ topic: 'Astrology' }), 'unknown topic')
  assert.ok(bad({ description: 'Too short and no format sections.' }), 'description')
  assert.ok(bad({ solutions: base.solutions.filter((f) => !/wrong_/.test(f)) }), 'no wrong program')
  assert.ok(bad({ tests: Array.from({ length: 21 }, (_, i) => ({ input: `${i}\n`, expected_output: '1', is_hidden: i > 5 })) }), 'over the executor limit of 20 tests')
})

test('Python and Node are available to verify the bank (required)', () => {
  const tc = toolchains()
  assert.ok(tc.python && tc.node, `toolchains: ${Object.keys(tc).join(', ')}`)
})

test('VERIFIED: reference solutions and brute-force oracles pass every test; every wrong program is rejected', { timeout: 600000 }, () => {
  const tc = toolchains()
  const summary = []
  for (const p of bank) {
    const r = verifyProblem(p)
    assert.deepEqual(r.errors, [], `${p.slug}: ${r.errors.join(' | ')}`)
    summary.push(...r.results.filter((x) => !x.unavailable).map((x) => x.base))
  }
  assert.ok(summary.filter((n) => n === 'reference.py').length === bank.length)
  assert.ok(summary.filter((n) => n === 'reference.js').length === bank.length)
  assert.ok(summary.filter((n) => n === 'oracle.py').length === bank.length)
  assert.ok(summary.filter((n) => /^wrong_/.test(n)).length >= bank.length)
  if (tc.java) assert.ok(summary.includes('Main.java'))
  if (tc.cpp) assert.ok(summary.includes('reference.cpp'))
})

test('mutation: the verifier notices a wrong expected output and a wrong program that passes', () => {
  const p = bank.find((x) => x.slug === 'min-coins')
  const only = (b) => b === 'reference.py' || b === 'oracle.py' || b === 'wrong_1.py'
  assert.equal(verifyProblem(p, { only }).ok, true)
  const corrupted = { ...p, tests: p.tests.map((t, i) => (i === 4 ? { ...t, expected_output: '999999' } : t)) }
  const r1 = verifyProblem(corrupted, { only })
  assert.equal(r1.ok, false); assert.ok(r1.errors.some((e) => /reference\.py fails/.test(e)))
  const weakTests = { ...p, tests: p.tests.filter((t) => ['3 11\n1 2 5\n', '1 3\n2\n'].includes(t.input) || /^1 0/.test(t.input) || /^1 10000/.test(t.input)) }
  // with only trivial tests the greedy mistake is not caught: the verifier must say so (structure errors are expected too, so check the specific message)
  assert.ok(verifyProblem(weakTests, { only }).errors.some((e) => /wrong_1\.py passes every test/.test(e)))
})

test('hidden-test data and reference solutions are not part of what the database stores or the API selects', () => {
  const seeder = require('fs').readFileSync(path.join(__dirname, '../../utils/problemSeeder.js'), 'utf8')
  assert.ok(!/solutions|reference|oracle|wrong_/.test(seeder.replace(/\/\*[\s\S]*?\*\//g, '')), 'seeder never reads solution files')
})

test('output comparison tolerates Windows CRLF line endings but nothing else', () => {
  const { sameOutput } = require('../../utils/solutionRunner')
  assert.equal(sameOutput('(())\r\n()()\r\n', '(())\n()()'), true, 'CRLF from a Windows interpreter')
  assert.equal(sameOutput('(())\n()()\n', '(())\n()()'), true)
  assert.equal(sameOutput('()() (())', '(())\n()()'), false, 'order / separators still matter')
  assert.equal(sameOutput('(())\n()()', '(())\n()() '), true, 'trailing whitespace is trimmed as before')
  assert.equal(sameOutput('(())\n\n()()', '(())\n()()'), false, 'blank lines are not ignored')
})
