/**
 * One vocabulary for coding results, shared by Run Code and Submit Code. It only RELABELS what the backend already reports
 * (executionStatus / status / test counts); it never decides whether code is correct. Hidden-test details are not involved.
 */
export const RESULT_LABELS = {
  passed: 'Passed',
  wrong_answer: 'Wrong Answer',
  runtime_error: 'Runtime Error',
  compilation_error: 'Compilation Error',
  time_limit_exceeded: 'Time Limit Exceeded',
  memory_limit_exceeded: 'Memory Limit Exceeded',
  output_limit_exceeded: 'Output Limit Exceeded',
  execution_error: 'Execution Error',
}

const TONES = {
  passed: 'success', wrong_answer: 'warning', runtime_error: 'danger', compilation_error: 'danger',
  time_limit_exceeded: 'warning', memory_limit_exceeded: 'warning', output_limit_exceeded: 'warning', execution_error: 'muted',
}

const EXPLANATIONS = {
  passed: 'Every test passed.',
  wrong_answer: 'Your program ran, but its output did not match on at least one test.',
  runtime_error: 'Your program crashed or exited with an error while running.',
  compilation_error: 'Your code did not compile, so no test could run.',
  time_limit_exceeded: 'Your program took too long on a test. Look for slow loops or an inefficient approach.',
  memory_limit_exceeded: 'Your program used more memory than allowed.',
  output_limit_exceeded: 'Your program printed more output than allowed (an endless loop that prints is a common cause).',
  execution_error: 'The code could not be run. This is not necessarily a problem with your code; please try again.',
}

const EXECUTION_TO_KEY = {
  compilation_error: 'compilation_error', runtime_error: 'runtime_error', timeout: 'time_limit_exceeded',
  memory_limit: 'memory_limit_exceeded', output_limit: 'output_limit_exceeded', execution_error: 'execution_error',
}

function counts(passed, total) {
  const p = Number.isFinite(Number(passed)) ? Number(passed) : null
  const t = Number.isFinite(Number(total)) ? Number(total) : null
  return { passed: p, total: t, failed: p !== null && t !== null ? Math.max(0, t - p) : null }
}

function build(key, passed, total, timeMs) {
  return {
    key, label: RESULT_LABELS[key], tone: TONES[key], explanation: EXPLANATIONS[key],
    ...counts(passed, total),
    timeMs: Number.isFinite(Number(timeMs)) && timeMs !== null ? Number(timeMs) : null,
  }
}

/** Submit Code response: { status: passed|failed|error, executionStatus?, test_cases_passed, test_cases_total, execution_time_ms }. */
export function describeSubmission(s) {
  if (!s) return null
  const base = [s.test_cases_passed, s.test_cases_total, s.execution_time_ms]
  if (s.status === 'passed') return build('passed', ...base)
  if (s.status === 'failed') return build('wrong_answer', ...base)
  return build(EXECUTION_TO_KEY[s.executionStatus] || 'execution_error', ...base)
}

/** Run Code response: { status: completed|<execution status>, passedTests, totalTests, executionTimeMs }. */
export function describeRun(r) {
  if (!r) return null
  const base = [r.passedTests, r.totalTests, r.executionTimeMs]
  if (r.status === 'completed') return build(r.totalTests > 0 && r.passedTests === r.totalTests ? 'passed' : 'wrong_answer', ...base)
  return build(EXECUTION_TO_KEY[r.status] || 'execution_error', ...base)
}
