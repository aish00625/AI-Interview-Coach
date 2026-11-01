const test = require('node:test')
const assert = require('node:assert/strict')
const { ruleBasedStar, sentences } = require('../../utils/starRules')
const { ruleBasedReport } = require('../../utils/reportRules')
const { buildDailyPlan } = require('../../utils/dailyPlan')

const GOOD = 'Last year our team missed a release date. I was responsible for the login module, so I reorganised tasks and wrote a test script. We shipped two days later and cut bugs by 30%.'

test('rule-based STAR: a complete answer is present everywhere and evidence is verbatim', () => {
  const r = ruleBasedStar(GOOD)
  assert.deepEqual(r.missing, []); assert.deepEqual(r.weak, [])
  for (const k of Object.keys(r.elements)) assert.ok(GOOD.includes(r.elements[k].evidence), k)
})
test('rule-based STAR: missing parts are named with an actionable suggestion; vague results are "weak"', () => {
  const r = ruleBasedStar('I like teamwork and I enjoy working with people.')
  assert.ok(r.missing.length >= 2); assert.ok(r.elements.result.suggestion.length > 10)
  const w = ruleBasedStar('Our team had a hard project last year. I was responsible for testing. I wrote many tests. It went well in the end.')
  assert.equal(w.elements.result.status, 'weak', 'a result without anything measurable is weak')
  assert.equal(ruleBasedStar('').missing.length, 4)
})
test('sentence splitter keeps decimals and abbreviations-free text intact', () => {
  assert.deepEqual(sentences('We grew 2.5x. Then we stopped.'), ['We grew 2.5x.', 'Then we stopped.'])
})

const item = (o) => ({ topic: 'Arrays', question: 'Q', technical: 80, relevance: 70, clarity: 90, completeness: 60, matched: [], missing: [], ...o })
test('rule-based report: states only real numbers, names the weakest dimension and the commonly missed points', () => {
  const r = ruleBasedReport({ finalScore: 72.4, items: [item({ missing: ['complexity', 'edge cases'] }), item({ topic: 'SQL', technical: 40, missing: ['complexity'] })] })
  assert.match(r.summary, /72\/100 across 2 answers/)
  assert.ok(r.improvements.some((x) => /complexity/.test(x))); assert.ok(r.improvements.some((x) => /SQL/.test(x)))
  assert.ok(r.nextSteps.length >= 1)
})
test('rule-based report: no answers -> honest empty report', () => {
  const r = ruleBasedReport({ finalScore: null, items: [] })
  assert.match(r.summary, /No answers/); assert.deepEqual(r.strengths, [])
})

test('daily plan: no history -> starter plan with no figures', () => {
  const p = buildDailyPlan({ hasAnyActivity: false })
  assert.equal(p.basis, 'no_history'); assert.ok(!/\d+%/.test(JSON.stringify(p)))
})
test('daily plan: built from next steps and a real weak topic, capped at 4 tasks, durations are positive', () => {
  const prep = {
    hasAnyActivity: true, overview: { totalInterviews: 3, distinctProblemsSolved: 2 },
    nextSteps: [
      { id: 'a', type: 'continue', title: 'Continue your Backend interview', reason: 'In progress.', link: '/interview/1' },
      { id: 'b', type: 'review', title: 'Review Arrays', reason: 'Due.', link: '/interview/setup' },
      { id: 'c', type: 'goal', title: 'Solve a coding problem', reason: '1 of 3', link: '/coding' },
    ],
    gapMap: { subjects: [{ subject: 'DSA', topics: [{ topic: 'Graphs', status: 'weak', score: 35, evidence: 'Average answer score 35/100 over 4 answers.' }, { topic: 'Arrays', status: 'strong', score: 90 }] }] },
  }
  const p = buildDailyPlan(prep)
  assert.equal(p.basis, 'practice_history'); assert.equal(p.tasks.length, 4)
  assert.ok(p.tasks.some((t) => /Graphs/.test(t.title) && /35%/.test(t.reason)))
  assert.equal(p.tasks.find((t) => t.id === 'c').type, 'coding')
  assert.equal(p.totalMinutes, p.tasks.reduce((s, t) => s + t.suggestedMinutes, 0))
})
test('daily plan: active user with nothing due still gets honest, count-based tasks', () => {
  const p = buildDailyPlan({ hasAnyActivity: true, overview: { totalInterviews: 1, distinctProblemsSolved: 0 }, nextSteps: [], gapMap: { subjects: [] } })
  assert.equal(p.tasks.length, 2); assert.match(p.tasks[0].reason, /1 interview so far/); assert.match(p.tasks[1].reason, /not solved a coding problem/)
})
