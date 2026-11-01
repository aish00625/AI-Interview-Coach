import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProgressMap, countSolved, progressFor, statusFor } from './codingProgress.js'

// Shapes exactly as the two endpoints send them: problems carry STRING ids (PostgreSQL BIGINT), progress carries NUMBER ids.
const problems = [{ id: '1', title: 'Two Sum' }, { id: '2', title: 'B' }, { id: '35', title: 'Rotate Array' }, { id: '36', title: 'D' }]
const rows = [
  { problemId: 1, status: 'solved', attempts: 3 },
  { problemId: 35, status: 'solved', attempts: 1 },
  { problemId: 2, status: 'attempted', attempts: 2 },
]

test('string problem ids find number progress ids (the bug: Map.get("1") missed key 1)', () => {
  const map = buildProgressMap(rows)
  assert.equal(statusFor(map, '1'), 'solved')
  assert.equal(statusFor(map, '35'), 'solved')
  assert.equal(statusFor(map, '2'), 'attempted')
  assert.equal(statusFor(map, '36'), 'new')
  assert.equal(progressFor(map, '1').attempts, 3)
  // the old lookup, for the record: a Map built from numeric keys does not answer a string key
  assert.equal(new Map(rows.map((r) => [r.problemId, r])).get(problems[0].id), undefined)
})

test('numeric and string ids are interchangeable on both sides', () => {
  assert.equal(statusFor(buildProgressMap(rows), 35), 'solved')
  assert.equal(statusFor(buildProgressMap([{ problemId: '35', status: 'solved' }]), 35), 'solved')
})

test('solved count is per distinct problem: attempted/new never count, duplicate rows and duplicate list entries count once', () => {
  assert.equal(countSolved(problems, buildProgressMap(rows)), 2)
  assert.equal(countSolved([...problems, ...problems], buildProgressMap(rows)), 2)
  assert.equal(countSolved(problems, buildProgressMap([...rows, { problemId: 1, status: 'solved', attempts: 9 }])), 2)
  assert.equal(countSolved(problems, buildProgressMap([{ problemId: 2, status: 'attempted' }])), 0)
})

test('empty or malformed progress is harmless', () => {
  assert.equal(countSolved(problems, buildProgressMap(undefined)), 0)
  assert.equal(countSolved(problems, buildProgressMap(null)), 0)
  assert.equal(statusFor(buildProgressMap([null, {}]), '1'), 'new')
  assert.equal(statusFor(undefined, '1'), 'new')
  assert.equal(countSolved(undefined, buildProgressMap(rows)), 0)
})
