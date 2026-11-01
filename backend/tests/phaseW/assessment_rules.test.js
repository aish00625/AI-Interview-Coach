// Phase W: pure rules of hirer assessments (migration 018) - validation, answer privacy, scoring, publishing, timing.
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../../utils/assessmentRules')

const goodQ = { sectionKind: 'aptitude', category: 'numerical', questionText: 'What is 2 + 2?', choices: ['3', '4', '5', '22'], correctKeys: ['B'], marks: 2 }

test('question validation: keys are assigned A, B, C...; 4-8 distinct choices; correct answers must exist and match the type', () => {
  const ok = rules.validateQuestion(goodQ)
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.question.choices.map((c) => c.key), ['A', 'B', 'C', 'D'])
  assert.deepEqual(ok.question.correctKeys, ['B'])
  const bad = (patch) => rules.validateQuestion({ ...goodQ, ...patch }).errors.length > 0
  assert.ok(bad({ choices: ['1', '2', '3'] }), 'fewer than four choices')
  assert.ok(bad({ choices: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }), 'more than eight')
  assert.ok(bad({ choices: ['1', '1', '2', '3'] }), 'duplicate choices')
  assert.ok(bad({ correctKeys: ['B', 'C'] }), 'single answer with two keys')
  assert.ok(bad({ questionType: 'multiple', correctKeys: ['B'] }), 'multiple answer with one key')
  assert.ok(bad({ correctKeys: ['F'] }), 'key that does not exist')
  assert.ok(bad({ correctKeys: [] }), 'no key')
  assert.ok(bad({ category: 'dbms' }), 'technical category in an aptitude question')
  assert.ok(bad({ sectionKind: 'coding' }), 'coding is not an MCQ kind')
  assert.ok(bad({ marks: 0 }), 'zero marks')
  assert.equal(rules.validateQuestion({ ...goodQ, questionType: 'multiple', correctKeys: ['D', 'B', 'B'] }).question.correctKeys.join(), 'B,D')
})

test('the candidate view of a question never contains the answer key or explanation', () => {
  const row = { question_text: 'Q?', question_type: 'single', choices: [{ key: 'A', text: 'x', correct: true }, { key: 'B', text: 'y' }], correct_keys: ['A'], explanation: 'SECRET-EXPLANATION' }
  const v = rules.candidateQuestion(row)
  assert.deepEqual(Object.keys(v).sort(), ['choices', 'questionText', 'questionType'])
  assert.deepEqual(v.choices, [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }], 'only key and text survive, even if extra fields sneak into choices')
  assert.doesNotMatch(JSON.stringify(v), /correct|SECRET-EXPLANATION/)
})

test('selections are normalised: unknown keys dropped, duplicates removed, sorted', () => {
  const choices = [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }]
  assert.deepEqual(rules.normalizeSelection(['C', 'A', 'A', 'Z', 3], choices), ['A', 'C'])
  assert.deepEqual(rules.normalizeSelection('A', choices), [])
})

test('MCQ scoring: exact match only, negative marking for wrong answers, nothing for unanswered', () => {
  assert.deepEqual(rules.scoreMcq({ selected: ['B'], correctKeys: ['B'], marks: 2 }), { answered: true, isCorrect: true, awarded: 2 })
  assert.deepEqual(rules.scoreMcq({ selected: ['A'], correctKeys: ['B'], marks: 2, negativeMarking: 0.25 }), { answered: true, isCorrect: false, awarded: -0.5 })
  assert.deepEqual(rules.scoreMcq({ selected: ['A'], correctKeys: ['B'], marks: 2 }), { answered: true, isCorrect: false, awarded: 0 })
  assert.deepEqual(rules.scoreMcq({ selected: [], correctKeys: ['B'], marks: 2, negativeMarking: 1 }), { answered: false, isCorrect: null, awarded: 0 })
  assert.equal(rules.scoreMcq({ selected: ['C', 'A'], correctKeys: ['A', 'C'], marks: 3 }).awarded, 3, 'order does not matter')
  assert.equal(rules.scoreMcq({ selected: ['A'], correctKeys: ['A', 'C'], marks: 3 }).isCorrect, false, 'no partial credit for multiple answers')
})

test('coding scoring: marks x best pass fraction; no submission scores 0', () => {
  assert.equal(rules.scoreCoding({ marks: 10, best: { tests_passed: 3, tests_total: 4 } }).awarded, 7.5)
  assert.equal(rules.scoreCoding({ marks: 10, best: null }).awarded, 0)
  assert.equal(rules.scoreCoding({ marks: 10, best: { tests_passed: 0, tests_total: 0 } }).awarded, 0)
})

test('section totals never go below zero; the pass mark is informational and optional', () => {
  assert.deepEqual(rules.sectionTotal([-0.5, -0.5], 4), { score: 0, max: 4 })
  const s = { aptitude: { score: 3, max: 4 }, coding: { score: 7.5, max: 10 } }
  assert.deepEqual(rules.overall(s, null), { score: 10.5, max: 14, percent: 75, meetsPassMark: null })
  assert.equal(rules.overall(s, 70).meetsPassMark, true)
  assert.equal(rules.overall(s, 80).meetsPassMark, false)
  assert.equal(rules.overall.length, 2, 'overall(sectionScores, passPercent): monitoring is not an input')
  assert.doesNotMatch(rules.overall.toString() + rules.scoreMcq.toString() + rules.scoreCoding.toString(), /monitor|face|gaze|head/i)
})

test('publish validation lists every problem and passes a complete assessment', () => {
  const a = { title: 'Backend screen', instructions: 'Read carefully.', duration_minutes: 60, available_until: null }
  const sections = [{ id: 1, kind: 'aptitude', position: 1, duration_minutes: 20, negative_marking: 0.25 }, { id: 2, kind: 'coding', position: 2, duration_minutes: 30, negative_marking: 0 }]
  const items = { 1: [{ coding_problem_id: null }], 2: [{ coding_problem_id: 5 }] }
  assert.deepEqual(rules.publishProblems(a, sections, items), [])
  assert.ok(rules.publishProblems({ ...a, instructions: '' }, sections, items).some((p) => /instructions/.test(p)))
  assert.ok(rules.publishProblems(a, sections, { 1: [], 2: items[2] }).some((p) => /no questions/.test(p)))
  assert.ok(rules.publishProblems({ ...a, duration_minutes: 40 }, sections, items).some((p) => /add up/.test(p)))
  assert.ok(rules.publishProblems(a, [sections[0], { ...sections[1], negative_marking: 0.5 }], items).some((p) => /coding/.test(p)))
  assert.ok(rules.publishProblems(a, [sections[0], { ...sections[1], position: 3 }], items).some((p) => /order/.test(p)))
  assert.ok(rules.publishProblems(a, sections, { 1: [{ coding_problem_id: null, archived: true }], 2: items[2] }).some((p) => /archived/.test(p)))
  assert.ok(rules.publishProblems(a, sections, { 1: [{ coding_problem_id: 9 }], 2: items[2] }).some((p) => /wrong type/.test(p)))
  assert.ok(rules.publishProblems({ ...a, available_until: '2000-01-01T00:00:00Z' }, sections, items).some((p) => /ended/.test(p)))
  assert.ok(rules.publishProblems(a, [], {}).some((p) => /at least one section/.test(p)))
})

test('timing is computed by the server: duration capped by the availability end; section deadlines capped by the attempt', () => {
  const start = Date.parse('2026-11-01T10:00:00Z')
  assert.equal(rules.attemptDeadline(start, 60, null), start + 3600000)
  assert.equal(rules.attemptDeadline(start, 60, '2026-11-01T10:30:00Z'), start + 1800000)
  assert.equal(rules.sectionDeadline(start, 10, start + 3600000), start + 600000)
  assert.equal(rules.sectionDeadline(start, 120, start + 3600000), start + 3600000)
  assert.equal(rules.sectionDeadline(null, 10, start + 3600000), start + 3600000)
})

test('availability: draft and closed assessments cannot be opened; the window is enforced', () => {
  const now = Date.parse('2026-11-01T10:00:00Z')
  assert.equal(rules.availability({ status: 'draft' }, now), 'not_published')
  assert.equal(rules.availability({ status: 'closed' }, now), 'closed')
  assert.equal(rules.availability({ status: 'published', available_from: '2026-11-02T00:00:00Z' }, now), 'not_open_yet')
  assert.equal(rules.availability({ status: 'published', available_until: '2026-11-01T09:00:00Z' }, now), 'window_ended')
  assert.equal(rules.availability({ status: 'published' }, now), null)
})

test('randomised order is a deterministic permutation per seed', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8]
  const a = rules.shuffled(ids, 42)
  assert.deepEqual([...a].sort((x, y) => x - y), ids)
  assert.deepEqual(rules.shuffled(ids, 42), a)
  assert.notDeepEqual(rules.shuffled(ids, 43), a)
})
