// Phase I: failed-test explanations (pure) and the executor-client contract v1.1 validation.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { root } = require('../phaseA/helpers')
const { explainFailure, summarizeRun, summarizeStderr, MAX_DIFF_LINES } = require(path.join(root, 'utils/testFeedback.js'))

const fail = (expected, actual, extra = {}) => explainFailure({ expected, actual, passed: false, ...extra })

test('explainFailure: names the most specific observable difference', () => {
  assert.equal(explainFailure({ expected: '1', actual: '1', passed: true }).category, 'passed')
  assert.equal(fail('7', '').category, 'no_output')
  assert.equal(fail('YES', 'yes').category, 'case_only')
  assert.equal(fail('1 2 3', '1  2\n3').category, 'whitespace_only')
  assert.equal(fail('a\nb', 'a\nb\nDEBUG').category, 'extra_output')
  assert.equal(fail('a\nb\nc', 'a\nb').category, 'partial_output')
  assert.equal(fail('1 2 3', '3 1 2').category, 'wrong_order')
  assert.equal(fail('10', '11').category, 'off_by_one')
  assert.match(fail('10', '9').message, /one too low/)
  assert.equal(fail('10', '-10').category, 'sign_error')
  assert.equal(fail('apple', 'pear').category, 'wrong_value')
  assert.equal(explainFailure({ expected: 'x', actual: null, timedOut: true, passed: false }).category, 'timeout')
  assert.equal(explainFailure({ expected: 'x', actual: null, passed: false }).category, 'no_result')
})

test('explainFailure: runtime errors use the last stderr line and never show sandbox paths', () => {
  const r = fail('1', 'partial', { stderr: 'Traceback (most recent call last):\n  File "/workspace/main.py", line 3, in <module>\nZeroDivisionError: division by zero' })
  assert.equal(r.category, 'runtime_error')
  assert.match(r.message, /ZeroDivisionError: division by zero/)
  assert.ok(!r.message.includes('/workspace'))
  assert.equal(summarizeStderr('  \n'), null)
  assert.ok(!summarizeStderr('error at /workspace/Main.java:3').includes('/workspace'))
})

test('buildDiff-backed output: line-by-line, capped, long lines clipped', () => {
  const many = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n')
  const r = fail(many, `${many}\nextra`)
  assert.equal(r.diff.rows.length, MAX_DIFF_LINES); assert.equal(r.diff.truncated, true)
  const longLine = fail('x'.repeat(500), 'y'.repeat(500))
  assert.ok(longLine.diff.rows[0].expected.length <= 201)
  const d = fail('a\nb\nc', 'a\nX\nc').diff.rows
  assert.deepEqual(d.map((x) => x.match), [true, false, true])
  assert.match(fail('a\nb\nc', 'a\nX\nc').message, /output line 2/)
})

test('summarizeRun: compile errors, timeouts, all-pass and partial-pass wording', () => {
  assert.match(summarizeRun({ status: 'compilation_error', stderr: 'Main.java:1: error: x', tests: [] }).nextStep, /error/)
  assert.match(summarizeRun({ status: 'timeout', stderr: '', tests: [] }).headline, /timed out/)
  const allPass = summarizeRun({ status: 'completed', stderr: '', tests: [{ index: 1, passed: true }, { index: 2, passed: true }] })
  assert.match(allPass.headline, /All 2/); assert.match(allPass.nextStep, /hidden tests/)
  const part = summarizeRun({ status: 'completed', stderr: '', tests: [{ index: 1, passed: true }, { index: 2, passed: false, explanation: { message: 'check it' } }] })
  assert.match(part.headline, /1 of 2/); assert.match(part.nextStep, /sample test 2: check it/)
})

test('codeExecutorClient accepts v1.0 and v1.1 results and rejects malformed optional fields', async () => {
  const client = require(path.join(root, 'services/codeExecutorClient.js'))
  const realFetch = global.fetch; process.env.CODE_EXECUTOR_URL = 'http://exec.test'
  const base = { status: 'completed', passedTests: 1, totalTests: 1, executionTimeMs: 3, memoryUsedKb: null, stderr: '' }
  const respond = (tests) => { global.fetch = async () => ({ ok: true, json: async () => ({ ...base, tests }) }) }
  const call = () => client.executeCode({ language: 'python', sourceCode: 'x', testCases: [{ input: '', expectedOutput: '1', returnOutput: true }] })
  try {
    respond([{ index: 1, passed: true }]); assert.equal((await call()).tests[0].index, 1)
    respond([{ index: 1, passed: true, actualOutput: '1', stderr: null, durationMs: 4 }]); assert.equal((await call()).tests[0].actualOutput, '1')
    respond([{ index: 1, passed: true, actualOutput: 5 }]); await assert.rejects(call(), { statusCode: 503 })
    respond([{ index: 1, passed: true, durationMs: -1 }]); await assert.rejects(call(), { statusCode: 503 })
    let sent
    global.fetch = async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ ...base, tests: [] }) } }
    await call()
    assert.equal(sent.testCases[0].returnOutput, true)
  } finally { global.fetch = realFetch }
})

// ---- sanitizeProgramText: based on REAL executor output captured from the sandbox (python, node, java, g++) ----
const { sanitizeProgramText } = require('../../utils/testFeedback')
test('sanitizeProgramText hides sandbox paths and Node internal frames but keeps the useful error', () => {
  const nodeErr = "/workspace/main.js:2\nnull.foo;\n     ^\n\nTypeError: Cannot read properties of null (reading 'foo')\n    at Object.<anonymous> (/workspace/main.js:2:6)\n    at Module._compile (node:internal/modules/cjs/loader:1706:14)\n    at Object..js (node:internal/modules/cjs/loader:1839:10)\n    at Function._load (node:internal/modules/cjs/loader:1263:12)"
  const out = sanitizeProgramText(nodeErr)
  assert.ok(!out.includes('/workspace'), out)
  assert.ok(!out.includes('node:internal'), out)
  assert.match(out, /TypeError: Cannot read properties of null/)
  assert.match(out, /main\.js:2/)
  const py = 'Traceback (most recent call last):\n  File "/workspace/main.py", line 2, in <module>\n    print(1/0)\nZeroDivisionError: division by zero\n'
  assert.match(sanitizeProgramText(py), /File "main\.py", line 2/)
  assert.equal(sanitizeProgramText('Main.java:1: error: incompatible types\n1 error\n'), 'Main.java:1: error: incompatible types\n1 error')
})
test('sanitizeProgramText hides other system paths, keeps empty/null as-is and truncates', () => {
  assert.ok(!sanitizeProgramText('error in /usr/lib/gcc/x86_64/13/cc1plus at /tmp/abc.o').includes('/usr'))
  assert.equal(sanitizeProgramText(''), '')
  assert.equal(sanitizeProgramText(null), null)
  assert.ok(sanitizeProgramText('x'.repeat(5000)).length <= 2001)
})
