/**
 * "Today's practice plan", built ONLY from the numbers in the candidate's own preparation data (see
 * preparationService.getPreparation). It is deterministic: every task carries the real fact that caused it, so nothing
 * is invented. A candidate with no history gets a starter plan that says so and shows no statistics.
 * The durations are suggestions (fixed per task type), not predictions.
 */
const MINUTES = { continue: 20, review: 20, coding: 30, goal: 25, start: 25 }
const MAX_TASKS = 4

function buildDailyPlan(prep) {
  if (!prep.hasAnyActivity) {
    return {
      basis: 'no_history', source: 'rule_based',
      intro: 'You have no practice history yet, so this is a starter plan. As you practise, it will be built from your own results.',
      tasks: [
        { id: 'first-interview', type: 'start', title: 'Do a short practice interview', reason: 'One interview gives the app something real to measure your progress against.', link: '/interview/setup', suggestedMinutes: MINUTES.start },
        { id: 'first-problem', type: 'start', title: 'Solve one easy coding problem', reason: 'An easy problem shows how running code and test results work.', link: '/coding', suggestedMinutes: 20 },
      ],
      totalMinutes: MINUTES.start + 20,
    }
  }
  const tasks = []
  for (const s of prep.nextSteps || []) {
    if (tasks.length >= MAX_TASKS) break
    const type = s.type === 'goal' && /problem/i.test(s.title) ? 'coding' : s.type
    tasks.push({ id: s.id, type, title: s.title, reason: s.reason, link: s.link, suggestedMinutes: MINUTES[type] || 20 })
  }
  // Weak topics with real numbers that are not already covered by a task.
  const weak = []
  for (const subject of (prep.gapMap && prep.gapMap.subjects) || []) for (const t of subject.topics || []) if (t.status === 'weak') weak.push(t)
  weak.sort((a, b) => a.score - b.score)
  for (const t of weak.slice(0, 1)) {
    if (tasks.length >= MAX_TASKS || tasks.some((x) => x.title.includes(t.topic))) continue
    tasks.push({ id: `weak-${t.topic}`, type: 'review', title: `Practise ${t.topic}`, reason: `Your ${t.topic} standing is weak (${t.score}%): ${t.evidence}`, link: '/interview/setup', suggestedMinutes: MINUTES.review })
  }
  if (tasks.length === 0) {
    // Nothing is overdue and no goal is set. Still give a useful, honest next step grounded in the real counts.
    const o = prep.overview || {}
    tasks.push({ id: 'keep-going-interview', type: 'start', title: 'Do another practice interview', reason: `You have completed ${o.totalInterviews || 0} interview${o.totalInterviews === 1 ? '' : 's'} so far. A new one adds data to your score trend and topic map.`, link: '/interview/setup', suggestedMinutes: MINUTES.start })
    tasks.push({ id: 'keep-going-coding', type: 'coding', title: 'Solve a coding problem', reason: (o.distinctProblemsSolved || 0) > 0 ? `You have solved ${o.distinctProblemsSolved} problem${o.distinctProblemsSolved === 1 ? '' : 's'} so far; try one you have not attempted.` : 'You have not solved a coding problem yet; an easy one is a good start.', link: '/coding', suggestedMinutes: MINUTES.coding })
  }
  return {
    basis: 'practice_history', source: 'rule_based',
    intro: 'Built from your own interview scores, coding results, weekly goals and review dates. Durations are suggestions.',
    tasks, totalMinutes: tasks.reduce((s, t) => s + t.suggestedMinutes, 0),
  }
}

module.exports = { buildDailyPlan, MINUTES }
