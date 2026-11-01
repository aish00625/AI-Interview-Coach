import test from 'node:test'
import assert from 'node:assert/strict'
import { describeSubmission, describeRun } from './codingStatus.js'
import { loadDraft, saveDraft, initialCode, loadLanguage, saveLanguage, clearDraft } from './codeDrafts.js'
import { problemNeighbours } from './problemNav.js'

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m } }

test('submission statuses map to the requested labels', () => {
  const base = { test_cases_passed: 1, test_cases_total: 4, execution_time_ms: 120 }
  assert.equal(describeSubmission({ ...base, status: 'passed', test_cases_passed: 4 }).label, 'Passed')
  assert.equal(describeSubmission({ ...base, status: 'failed' }).label, 'Wrong Answer')
  const exp = { compilation_error: 'Compilation Error', runtime_error: 'Runtime Error', timeout: 'Time Limit Exceeded', execution_error: 'Execution Error', memory_limit: 'Memory Limit Exceeded', output_limit: 'Output Limit Exceeded' }
  for (const [k, label] of Object.entries(exp)) assert.equal(describeSubmission({ ...base, status: 'error', executionStatus: k }).label, label, k)
  assert.equal(describeSubmission({ ...base, status: 'error' }).label, 'Execution Error') // old stored rows carry no executionStatus
  assert.equal(describeSubmission(null), null)
})

test('counts: passed, failed, total and time come only from the response', () => {
  const d = describeSubmission({ status: 'failed', test_cases_passed: 3, test_cases_total: 5, execution_time_ms: 42 })
  assert.deepEqual([d.passed, d.failed, d.total, d.timeMs], [3, 2, 5, 42])
  const noTime = describeSubmission({ status: 'failed', test_cases_passed: 0, test_cases_total: 2, execution_time_ms: null })
  assert.equal(noTime.timeMs, null)
  assert.equal(describeSubmission({ status: 'error', executionStatus: 'compilation_error' }).failed, null)
})

test('Run Code: completed run is Passed only when every sample passed', () => {
  assert.equal(describeRun({ status: 'completed', passedTests: 2, totalTests: 2 }).label, 'Passed')
  assert.equal(describeRun({ status: 'completed', passedTests: 1, totalTests: 2 }).label, 'Wrong Answer')
  assert.equal(describeRun({ status: 'completed', passedTests: 0, totalTests: 0 }).label, 'Wrong Answer') // never claims a pass without tests
  assert.equal(describeRun({ status: 'timeout', passedTests: 0, totalTests: 2 }).label, 'Time Limit Exceeded')
})

test('drafts: saved, restored per problem and language, dropped when equal to the starter, never throws', () => {
  const s = memStore()
  assert.equal(initialCode(7, 'python', 'STARTER', s), 'STARTER')
  assert.equal(saveDraft(7, 'python', 'my code', 'STARTER', s), true)
  assert.equal(initialCode(7, 'python', 'STARTER', s), 'my code')
  assert.equal(initialCode(7, 'java', 'JSTART', s), 'JSTART')   // other language untouched
  assert.equal(initialCode(8, 'python', 'S8', s), 'S8')         // other problem untouched
  saveDraft(7, 'python', 'STARTER', 'STARTER', s)
  assert.equal(loadDraft(7, 'python', s), null)
  saveDraft(7, 'python', 'x', 'S', s); clearDraft(7, 'python', s); assert.equal(loadDraft(7, 'python', s), null)
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(loadDraft(1, 'cpp', broken), null); assert.equal(saveDraft(1, 'cpp', 'a', '', broken), false); assert.equal(initialCode(1, 'cpp', 'S', broken), 'S')
})

test('language preference is validated', () => {
  const s = memStore()
  assert.equal(loadLanguage('javascript', s), 'javascript')
  saveLanguage('java', s); assert.equal(loadLanguage('javascript', s), 'java')
  saveLanguage('cobol', s); assert.equal(loadLanguage('javascript', s), 'java')
  s.setItem('aic-coding-language', 'rust'); assert.equal(loadLanguage('javascript', s), 'javascript')
})

test('problem neighbours come from the real list order; first has no prev, last has no next', () => {
  const list = [{ id: 3 }, { id: 5 }, { id: 9 }]
  assert.deepEqual(problemNeighbours(list, '3'), { index: 0, total: 3, prev: null, next: { id: 5 } })
  assert.equal(problemNeighbours(list, 5).prev.id, 3); assert.equal(problemNeighbours(list, 5).next.id, 9)
  assert.equal(problemNeighbours(list, 9).next, null)
  assert.deepEqual(problemNeighbours(list, 99), { index: -1, total: 3, prev: null, next: null })
  assert.deepEqual(problemNeighbours(null, 1), { index: -1, total: 0, prev: null, next: null })
})

import { interviewProgress } from './interviewProgress.js'
test('interview progress counts answered and skipped separately and never invents totals', () => {
  const q = [
    { id: 1, answered: true, answer: { evaluation_meta: { skipped: false } } },
    { id: 2, answered: true, answer: { evaluation_meta: { skipped: true } } },
    { id: 3, answered: false },
    { id: 4, answered: true, answer: {} },
  ]
  assert.deepEqual(interviewProgress(q, 3), { total: 4, answered: 2, skipped: 1, done: 3, remaining: 1, position: 3, percent: 75 })
  assert.deepEqual(interviewProgress([], 1), { total: 0, answered: 0, skipped: 0, done: 0, remaining: 0, position: null, percent: 0 })
  assert.equal(interviewProgress(q, 99).position, null)
})
