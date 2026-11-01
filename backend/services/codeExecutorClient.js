/**
 * HTTP client for the Python code-executor service, per the Phase 1
 * architecture: Node → Code Executor → Docker, never React → Docker
 * directly, and never `eval()`/child_process on this Node host. The
 * executor has no PostgreSQL access of its own — Node is the only thing
 * that reads coding_problems.test_cases, and it sends those test cases
 * to the executor over this HTTP call; the executor never queries the
 * database itself.
 *
 * Mirrors aiServiceClient.js's shape (timeout, shared-secret header,
 * response-shape validation, safe-error-on-any-failure) deliberately —
 * same trust boundary, same failure philosophy.
 */

// Generous relative to EXECUTION_TIMEOUT_MS * MAX_TEST_CASES on the
// executor side (2s * 20 tests = 40s default) plus compile time headroom.
const CODE_EXECUTOR_TIMEOUT_MS = 45000

const VALID_STATUSES = new Set([
  'completed', 'compilation_error', 'runtime_error',
  'timeout', 'memory_limit', 'output_limit', 'execution_error',
])

function serviceUnavailableError(message = 'Code execution service is temporarily unavailable.') {
  const err = new Error(message)
  err.statusCode = 503
  return err
}

/** Confirms the executor's response actually has the shape codingService/interview_answers expect, before any of it is trusted. */
function isValidExecutionResult(data) {
  if (!data || typeof data !== 'object') return false
  if (typeof data.status !== 'string' || !VALID_STATUSES.has(data.status)) return false
  if (!Number.isInteger(data.passedTests) || data.passedTests < 0) return false
  if (!Number.isInteger(data.totalTests) || data.totalTests < 0) return false
  if (!Number.isInteger(data.executionTimeMs) || data.executionTimeMs < 0) return false
  if (data.memoryUsedKb !== null && data.memoryUsedKb !== undefined && !Number.isInteger(data.memoryUsedKb)) return false
  if (!Array.isArray(data.tests)) return false
  // Executor contract v1.1 (optional per-test fields, present only for tests flagged returnOutput). A v1.0
  // executor simply omits them. Each is validated if present so a malformed value is never trusted.
  const optStr = (v) => v === undefined || v === null || typeof v === 'string'
  const optInt = (v) => v === undefined || v === null || (Number.isInteger(v) && v >= 0)
  const testsOk = data.tests.every(
    (t) => t && Number.isInteger(t.index) && typeof t.passed === 'boolean'
      && optStr(t.actualOutput) && optStr(t.stderr) && optInt(t.durationMs),
  )
  if (!testsOk) return false
  if (typeof data.stderr !== 'string') return false
  return true
}

/**
 * Sends one submission's code + the AUTHORITATIVE test cases (already
 * fetched from PostgreSQL by the caller — never from the browser) to the
 * executor's POST /execute and returns its result. Never fabricates a
 * result: any failure — the service being down, a timeout, an HTTP
 * error, or a malformed response — throws a controlled 503 rather than
 * pretending the code passed or failed.
 *
 * Executor contract v1.1: a test case may carry `returnOutput: true` (set ONLY for the problem's visible sample
 * tests) to ask the executor to echo the program's actual output for that test. Without it the request and response
 * are identical to v1.0.
 *
 * @param {{ language: string, sourceCode: string, testCases: Array<{input: string, expectedOutput: string, returnOutput?: boolean}>, timeoutMs?: number }} params
 */
async function executeCode({ language, sourceCode, testCases, timeoutMs }) {
  const baseUrl = process.env.CODE_EXECUTOR_URL
  if (!baseUrl) throw serviceUnavailableError()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CODE_EXECUTOR_TIMEOUT_MS)

  let response
  try {
    response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Code-Executor-Key': process.env.CODE_EXECUTOR_API_KEY || '',
      },
      body: JSON.stringify({
        language,
        sourceCode,
        testCases,
        timeoutMs: timeoutMs ?? null,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    // Network error, connection refused, or the AbortController firing on timeout.
    throw serviceUnavailableError()
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    // Don't forward the executor's own error body/stack to the frontend.
    throw serviceUnavailableError()
  }

  let data
  try {
    data = await response.json()
  } catch {
    throw serviceUnavailableError('Code execution service returned an invalid response.')
  }

  if (!isValidExecutionResult(data)) {
    throw serviceUnavailableError('Code execution service returned an invalid response.')
  }

  return data
}

/** Is the executor process answering? Short timeout, never throws. */
async function getHealth() {
  const baseUrl = process.env.CODE_EXECUTOR_URL
  if (!baseUrl) return { configured: false, reachable: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal })
    const body = await res.json().catch(() => null)
    return { configured: true, reachable: res.ok && body && body.status === 'ok', httpStatus: res.status }
  } catch {
    return { configured: true, reachable: false }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { executeCode, getHealth }
