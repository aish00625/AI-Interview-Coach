// Phase N: the pure rules behind the preparation dashboard. Expected numbers are worked out by hand in the comments.
const test = require('node:test')
const assert = require('node:assert/strict')
const p = require('../../utils/preparation')

const at = (iso) => new Date(iso)

test('weekStartUtc returns Monday 00:00 UTC (Saturday and Monday inputs)', () => {
  assert.equal(p.weekStartUtc(at('2026-10-24T10:00:00Z')).toISOString(), '2026-10-19T00:00:00.000Z') // Sat -> Mon 19th
  assert.equal(p.weekStartUtc(at('2026-10-19T00:00:00Z')).toISOString(), '2026-10-19T00:00:00.000Z') // Monday itself
  assert.equal(p.weekStartUtc(at('2026-10-25T23:59:59Z')).toISOString(), '2026-10-19T00:00:00.000Z') // Sunday night
})

test('streaks: current survives until the end of the day after the last activity; longest is tracked separately', () => {
  const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24']
  assert.deepEqual(p.computeStreaks(days, at('2026-10-24T10:00:00Z')), { current: 1, longest: 3, lastActiveDay: '2026-10-24' })
  assert.equal(p.computeStreaks(days, at('2026-10-23T08:00:00Z')).current, 3) // today empty, yesterday (22nd) active -> 22,21,20
  assert.equal(p.computeStreaks(days, at('2026-10-25T08:00:00Z')).current, 1) // yesterday is the 24th
  assert.equal(p.computeStreaks(days, at('2026-10-26T08:00:00Z')).current, 0) // a whole day missed
  assert.deepEqual(p.computeStreaks([], at('2026-10-24T00:00:00Z')), { current: 0, longest: 0, lastActiveDay: null })
  assert.equal(p.computeStreaks(['2026-10-24', '2026-10-24'], at('2026-10-24T00:00:00Z')).longest, 1) // duplicates collapse
})

test('heatmap zero-fills the window, keeps real counts and scales levels 0-4', () => {
  const cells = p.buildHeatmap([{ day: '2026-10-24', count: 4 }, { day: '2026-10-23', count: 1 }], at('2026-10-24T12:00:00Z'), 3)
  assert.deepEqual(cells.map((c) => [c.date, c.count, c.level]), [['2026-10-22', 0, 0], ['2026-10-23', 1, 1], ['2026-10-24', 4, 4]])
  const empty = p.buildHeatmap([], at('2026-10-24T12:00:00Z'), 2)
  assert.deepEqual(empty.map((c) => c.level), [0, 0])
})

test('classifyTopic: no data / too little / weak / developing / strong, with confidence by evidence amount', () => {
  assert.equal(p.classifyTopic({}).status, 'no_data')
  const few = p.classifyTopic({ interviewAverage: 90, interviewAnswers: 1 })
  assert.equal(few.status, 'insufficient_data'); assert.equal(few.score, null); assert.equal(few.confidence, 'low')
  const strong = p.classifyTopic({ interviewAverage: 80, interviewAnswers: 3 })
  assert.deepEqual([strong.status, strong.score, strong.confidence], ['strong', 80, 'medium'])
  assert.match(strong.evidence, /80\/100 over 3 answers/)
  const weak = p.classifyTopic({ codingAttempted: 4, codingSolved: 1 })                   // 25%
  assert.deepEqual([weak.status, weak.score], ['weak', 25])
  const mixed = p.classifyTopic({ interviewAverage: 40, interviewAnswers: 3, codingAttempted: 4, codingSolved: 4 }) // (40+100)/2 = 70
  assert.deepEqual([mixed.status, mixed.score, mixed.confidence], ['strong', 70, 'medium'])
  assert.equal(p.classifyTopic({ interviewAverage: 55, interviewAnswers: 2 }).status, 'developing')
  assert.equal(p.classifyTopic({ interviewAverage: 55, interviewAnswers: 10 }).confidence, 'high')
  assert.equal(p.classifyTopic({ codingAttempted: 1, codingSolved: 1 }).status, 'insufficient_data')   // one problem is not enough to judge
})

test('groupBySubject puts known topics in DSA / fundamentals and the rest under Other; empty groups vanish', () => {
  const g = p.groupBySubject([{ topic: 'Arrays' }, { topic: 'DBMS' }, { topic: 'Quantum' }])
  assert.deepEqual(g.map((x) => [x.subject, x.topics.map((t) => t.topic)]), [['Data structures & algorithms', ['Arrays']], ['CS fundamentals', ['DBMS']], ['Other', ['Quantum']]])
  assert.deepEqual(p.groupBySubject([{ topic: 'OOP' }]).map((x) => x.subject), ['CS fundamentals'])
})

test('review intervals and due logic', () => {
  assert.deepEqual([40, 50, 69, 70, 84, 85, 100].map(p.reviewIntervalDays), [1, 3, 3, 7, 7, 14, 14])
  const due = p.reviewSchedule({ score: 45, lastPracticedAt: '2026-10-20T00:00:00Z' }, at('2026-10-22T00:00:00Z'))
  assert.deepEqual([due.intervalDays, due.isDue, due.overdueDays, due.dueAt], [1, true, 1, '2026-10-21T00:00:00.000Z'])
  const later = p.reviewSchedule({ score: 90, lastPracticedAt: '2026-10-20T00:00:00Z' }, at('2026-10-25T00:00:00Z'))
  assert.deepEqual([later.intervalDays, later.isDue, later.overdueDays], [14, false, 0])
  assert.equal(p.reviewSchedule({ score: null, lastPracticedAt: '2026-10-20T00:00:00Z' }, new Date()), null)
  assert.equal(p.reviewSchedule({ score: 50, lastPracticedAt: null }, new Date()), null)
})

test('readiness: weighted average of available components, renormalised, null when under two components', () => {
  // interview 80*0.4 + coding 50*0.3 + coverage round(5/17*100)=29 *0.2 + consistency round(3/7*100)=43 *0.1 = 32+15+5.8+4.3 = 57.1
  const full = p.computeReadiness({ interviewRecentAverage: 80, interviewRecentCount: 2, codingAttempted: 4, codingSolved: 2, topicsPracticed: 5, topicsTotal: 17, activeDaysLast14: 3 })
  assert.equal(full.score, 57); assert.equal(full.band, 'Building'); assert.equal(full.basedOn, 4)
  assert.ok(full.limitations.length >= 3)
  // only interview (80, w .4) and consistency (1 day -> 14, w .1): (32 + 1.4) / 0.5 = 66.8
  const part = p.computeReadiness({ interviewRecentAverage: 80, interviewRecentCount: 1, codingAttempted: 2, codingSolved: 2, topicsPracticed: 0, topicsTotal: 17, activeDaysLast14: 1 })
  assert.equal(part.score, 67); assert.equal(part.basedOn, 2)
  assert.equal(part.components.find((c) => c.key === 'coding').available, false)   // 2 attempted < 3 needed
  const one = p.computeReadiness({ interviewRecentAverage: 80, interviewRecentCount: 1, codingAttempted: 0, codingSolved: 0, topicsPracticed: 0, topicsTotal: 17, activeDaysLast14: 0 })
  assert.equal(one.score, null); assert.match(one.reason, /Not enough practice data/)
  const none = p.computeReadiness({ interviewRecentAverage: null, interviewRecentCount: 0, codingAttempted: 0, codingSolved: 0, topicsPracticed: 0, topicsTotal: 17, activeDaysLast14: 0 })
  assert.equal(none.score, null)
  assert.equal(p.computeReadiness({ interviewRecentAverage: 95, interviewRecentCount: 5, codingAttempted: 10, codingSolved: 10, topicsPracticed: 17, topicsTotal: 17, activeDaysLast14: 14 }).band, 'Well practised')
  assert.equal(p.computeReadiness({ interviewRecentAverage: 20, interviewRecentCount: 1, codingAttempted: 3, codingSolved: 0, topicsPracticed: 1, topicsTotal: 17, activeDaysLast14: 1 }).band, 'Getting started')
})

test('suggested difficulty and problem pick', () => {
  assert.deepEqual([[0, 0], [4, 1], [4, 3], [4, 4], [3, 3]].map(([a, s]) => p.suggestedDifficulty({ codingAttempted: a, codingSolved: s })), ['easy', 'easy', 'medium', 'hard', 'medium'])
  const list = [{ id: 5, difficulty: 'easy' }, { id: 2, difficulty: 'medium' }, { id: 9, difficulty: 'hard' }]
  assert.equal(p.pickProblem(list, 'hard').id, 9)
  assert.equal(p.pickProblem([list[0], list[2]], 'medium').id, 5)   // tie between easy and hard -> lowest id
  assert.equal(p.pickProblem([], 'easy'), null)
})

test('next steps: first-time user gets starter actions; active user gets reasons from real facts; capped at 5', () => {
  const first = p.recommendNextSteps({ hasAnyActivity: false, hasProfileSkills: false })
  assert.deepEqual(first.map((s) => s.id), ['first-interview', 'first-problem', 'profile'])
  assert.equal(p.recommendNextSteps({ hasAnyActivity: false, hasProfileSkills: true }).length, 2)
  const steps = p.recommendNextSteps({
    hasAnyActivity: true, inProgress: { id: 7, targetRole: 'Backend Dev' },
    dueReviews: [{ topic: 'Arrays', lastPracticedDaysAgo: 4, status: 'weak', score: 30 }, { topic: 'DBMS', lastPracticedDaysAgo: 1, status: 'developing', score: 60 }, { topic: 'OOP', lastPracticedDaysAgo: 9, status: 'strong', score: 90 }],
    goals: { weeklyInterviews: 3, weeklyProblems: 5 }, progress: { interviews: 1, problems: 5 },
    suggestedProblems: [{ id: 11, title: 'Two Sum', reason: 'r1' }, { id: 12, title: 'Valid Anagram', reason: 'r2' }, { id: 13, title: 'x', reason: 'r3' }],
  })
  assert.equal(steps.length, 5)
  assert.deepEqual(steps.map((s) => s.type), ['continue', 'review', 'review', 'goal', 'coding'])
  assert.equal(steps[0].link, '/interview/7'); assert.match(steps[1].reason, /4 days ago/); assert.match(steps[2].reason, /1 day ago/)
  assert.match(steps[3].reason, /1 of 3/)   // problem goal already met, so only the interview goal appears
  assert.equal(steps[4].link, '/coding/11')
})
