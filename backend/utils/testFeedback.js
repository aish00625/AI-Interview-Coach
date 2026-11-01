/**
 * Plain-language explanations for a failed sample test. Pure and deterministic (no AI): it compares the program's
 * actual output with the expected output and names the most specific, genuinely observable difference. It only ever
 * receives data for tests that are already public to the candidate (the problem's visible sample tests).
 *
 * The executor compares `actual.trim() === expected.trim()`, so a test fails on ANY other difference - including
 * spacing inside the output - and the messages below say so rather than hiding it.
 */
const MAX_DIFF_LINES = 20
const MAX_LINE_CHARS = 200

const clip = (s) => (s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS)}…` : s)
const lines = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim().split('\n')
const tokens = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean)
const isNum = (t) => /^[-+]?\d+(\.\d+)?$/.test(t)

/** Last meaningful line of a runtime error, with sandbox paths stripped so nothing environment-specific is shown. */
function summarizeStderr(stderr) {
  const all = String(stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (!all.length) return null
  const last = all[all.length - 1].replace(/\/workspace\/[^\s:)'"]*/g, '<your file>')
  return clip(last)
}

/**
 * Program/compiler text that is safe to show: sandbox and system paths are reduced to the bare file name and Node's internal
 * stack frames are dropped. Real executor output (see code-executor smoke tests) contains "/workspace/main.py" and
 * "node:internal/modules/..." lines, which say nothing useful about the user's code. Defensive: also hides /usr, /opt, /tmp, /proc.
 */
function sanitizeProgramText(text, maxChars = 2000) {
  if (text == null) return text
  const kept = String(text).replace(/\r\n/g, '\n').split('\n').filter((l) => !/\(?node:internal\/|^\s+at (?:Module|Object\.\.js|Function\._load|TracingChannel|node:)/.test(l))
  const out = kept.join('\n')
    .replace(/\/workspace\/([^\s:)'"]*)/g, '$1')
    .replace(/(?:\/usr|\/opt|\/tmp|\/proc|\/var|\/home|\/root)\/[^\s:)'"]*/g, '<system path>')
    .trim()
  return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out
}

function buildDiff(expected, actual) {
  const e = lines(expected); const a = lines(actual)
  const n = Math.min(Math.max(e.length, a.length), MAX_DIFF_LINES)
  const out = []
  for (let i = 0; i < n; i++) {
    const el = i < e.length ? clip(e[i]) : null
    const al = i < a.length ? clip(a[i]) : null
    out.push({ line: i + 1, expected: el, actual: al, match: el === al })
  }
  return { rows: out, truncated: Math.max(e.length, a.length) > MAX_DIFF_LINES }
}

/**
 * @param {{ expected: string, actual: string|null, stderr?: string|null, timedOut?: boolean, passed: boolean }} t
 * @returns {{ category: string, message: string, diff: object|null }}
 */
function explainFailure(t) {
  if (t.passed) return { category: 'passed', message: 'This test passed.', diff: null }
  if (t.timedOut) {
    return { category: 'timeout', message: 'Your program did not finish within the time limit on this test. Look for an infinite loop, or an approach that is too slow for the input size (for example nested loops where a single pass or a hash map would do).', diff: null }
  }
  if (t.actual == null) {
    return { category: 'no_result', message: 'No output was captured for this test, so it cannot be compared. If other tests ran, the program may have been stopped (for example by a time limit) before this one.', diff: null }
  }
  const stderrLine = summarizeStderr(t.stderr)
  if (stderrLine) {
    return { category: 'runtime_error', message: `Your program crashed on this input: ${stderrLine}. Check array bounds, empty input, and operations on null/undefined values.`, diff: null }
  }

  const expected = String(t.expected ?? ''); const actual = String(t.actual ?? '')
  const diff = buildDiff(expected, actual)
  const eTrim = expected.trim(); const aTrim = actual.trim()

  if (aTrim === '' && eTrim !== '') {
    return { category: 'no_output', message: 'Your program printed nothing for this test. Make sure it reads the input from standard input and prints the answer to standard output.', diff }
  }
  if (aTrim.toLowerCase() === eTrim.toLowerCase()) {
    return { category: 'case_only', message: 'The output matches except for letter case. Check the exact capitalisation the problem asks for.', diff }
  }
  const et = tokens(expected); const at = tokens(actual)
  if (et.join(' ') === at.join(' ')) {
    return { category: 'whitespace_only', message: 'The values are right but the spacing or line breaks differ. This checker compares the output exactly (apart from leading/trailing whitespace), so match the sample format: separators, spaces and one value per line as shown.', diff }
  }
  const el = lines(expected); const al = lines(actual)
  if (al.length > el.length && el.every((l, i) => l === al[i])) {
    return { category: 'extra_output', message: `Your output has ${al.length - el.length} extra line(s) after the expected answer. Remove debug prints or extra output.`, diff }
  }
  if (al.length < el.length && al.every((l, i) => l === el[i])) {
    return { category: 'partial_output', message: `Your output stops early: it has ${al.length} line(s) but ${el.length} are expected. Check that every case is printed.`, diff }
  }
  if (et.length === at.length && [...et].sort().join('\u0000') === [...at].sort().join('\u0000')) {
    return { category: 'wrong_order', message: 'You produced the right values but in a different order than expected. Check how the problem asks for the results to be ordered.', diff }
  }
  if (et.length === 1 && at.length === 1 && isNum(et[0]) && isNum(at[0])) {
    const d = Number(at[0]) - Number(et[0])
    if (Math.abs(d) === 1) return { category: 'off_by_one', message: `Your number is off by one (${d > 0 ? 'one too high' : 'one too low'}). Check loop bounds, 0- versus 1-based indexing, and the initial value.`, diff }
    if (Number(at[0]) === -Number(et[0])) return { category: 'sign_error', message: 'Your number has the opposite sign from the expected one.', diff }
  }
  const first = diff.rows.find((r) => !r.match)
  const where = first ? `The first difference is on output line ${first.line}.` : ''
  return { category: 'wrong_value', message: `Your output differs from the expected output. ${where} Trace this input by hand and compare each step with your code.`.trim(), diff }
}

/** One call per run: decorates each visible-test result with an explanation and gives an overall next-step suggestion. */
function summarizeRun({ status, stderr, tests }) {
  if (status === 'compilation_error') {
    return { headline: 'Your code did not compile.', nextStep: summarizeStderr(stderr) ? `Fix this first: ${summarizeStderr(stderr)}` : 'Fix the compiler error shown below.' }
  }
  if (status === 'timeout') return { headline: 'Your code timed out.', nextStep: 'Consider the time complexity of your approach and check for infinite loops.' }
  if (status === 'memory_limit' || status === 'output_limit') return { headline: status === 'memory_limit' ? 'Your code used too much memory.' : 'Your code printed too much output.', nextStep: 'Avoid storing or printing more than the problem needs.' }
  if (status === 'execution_error') return { headline: 'The run could not be completed.', nextStep: 'This may be a problem with the execution service rather than your code. Try again.' }
  const failed = tests.filter((t) => !t.passed)
  if (!tests.length) return { headline: 'No sample tests were run.', nextStep: null }
  if (!failed.length) return { headline: `All ${tests.length} sample test(s) passed.`, nextStep: 'Sample tests are only a start - Submit also runs hidden tests, so think about empty, minimum, maximum and duplicate inputs.' }
  return { headline: `${tests.length - failed.length} of ${tests.length} sample test(s) passed.`, nextStep: `Start with sample test ${failed[0].index}: ${failed[0].explanation.message}` }
}

module.exports = { explainFailure, summarizeRun, summarizeStderr, sanitizeProgramText, buildDiff, MAX_DIFF_LINES }
