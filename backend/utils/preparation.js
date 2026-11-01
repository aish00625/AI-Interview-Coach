/**
 * Pure, deterministic calculations behind the candidate "preparation" dashboard. No database, no network, no clock
 * (callers pass `now`), so every rule below is unit-tested and explainable in a viva.
 *
 * IMPORTANT HONESTY NOTES (also shown to the user in the API response):
 *  - Every threshold and weight here is a hand-chosen heuristic. None has been validated against real interview outcomes.
 *  - Nothing here predicts whether anyone will pass a real interview or get a job.
 *  - Only the candidate's own PRACTICE records are used (hiring-assessment attempts are never included).
 */

const DAY_MS = 86400000

/* ------------------------------ dates ------------------------------ */

/** 'YYYY-MM-DD' in UTC. */
function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10)
}

/** Monday 00:00 UTC of the week containing `now` (weeks run Monday-Sunday, UTC). */
function weekStartUtc(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(d.getTime() - dow * DAY_MS)
}

/* ------------------------------ streaks ------------------------------ */

/**
 * @param {string[]} days unique 'YYYY-MM-DD' strings on which the user did any practice
 * @returns {{ current: number, longest: number, lastActiveDay: string|null }}
 * The current streak survives until the end of the day after the last activity (so practising yesterday still
 * counts today); it is 0 once a full day has been missed.
 */
function computeStreaks(days, now) {
  const set = new Set(days)
  const sorted = [...set].sort()
  if (!sorted.length) return { current: 0, longest: 0, lastActiveDay: null }

  let longest = 1; let run = 1
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / DAY_MS
    run = gap === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }

  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getTime() - DAY_MS))
  let cursor = set.has(today) ? today : set.has(yesterday) ? yesterday : null
  let current = 0
  while (cursor && set.has(cursor)) {
    current += 1
    cursor = dayKey(new Date(Date.parse(cursor) - DAY_MS))
  }
  return { current, longest, lastActiveDay: sorted[sorted.length - 1] }
}

/* ------------------------------ heatmap ------------------------------ */

/**
 * Contiguous day cells for the last `days` days (oldest first) built from real per-day counts. Days with no recorded
 * activity are genuine zeros. `level` is 0-4: 0 = none, 1-4 = quartiles of the busiest day in the window.
 */
function buildHeatmap(rows, now, days = 84) {
  const counts = new Map(rows.map((r) => [r.day, Number(r.count)]))
  const end = Date.parse(dayKey(now))
  const cells = []
  for (let i = days - 1; i >= 0; i--) {
    const date = dayKey(new Date(end - i * DAY_MS))
    cells.push({ date, count: counts.get(date) || 0 })
  }
  const max = Math.max(0, ...cells.map((c) => c.count))
  for (const c of cells) c.level = c.count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((c.count / max) * 4)))
  return cells
}

/* ------------------------------ knowledge gaps ------------------------------ */

const MIN_EVIDENCE = 2 // answers or distinct problems needed before a signal is trusted at all
const WEAK_BELOW = 50
const DEVELOPING_BELOW = 70

/**
 * One topic's standing from the candidate's own records.
 * Signals: average interview technical score (needs >= 2 scored answers) and the share of distinct attempted coding
 * problems that were solved (needs >= 2 attempted). The score is the mean of the signals that qualify.
 * status: no_data (nothing at all) | insufficient_data (something, but too little) | weak | developing | strong
 * confidence reflects how much evidence there is, NOT how accurate the score is: low < 3 items, medium < 8, else high.
 */
function classifyTopic({ interviewAverage = null, interviewAnswers = 0, interviewUnscored = 0, codingAttempted = 0, codingSolved = 0 }) {
  const evidenceUnits = interviewAnswers + codingAttempted
  const signals = []
  if (interviewAverage != null && interviewAnswers >= MIN_EVIDENCE) signals.push({ source: 'interview answers', value: Number(interviewAverage), n: interviewAnswers })
  if (codingAttempted >= MIN_EVIDENCE) signals.push({ source: 'coding problems', value: (100 * codingSolved) / codingAttempted, n: codingAttempted })

  // Skipped / not-evaluable answers are not evidence either way: a topic is never "weak" merely because it was skipped.
  if (evidenceUnits === 0 && interviewUnscored > 0) {
    return { status: 'insufficient_data', score: null, confidence: 'low', evidence: `${interviewUnscored} answer${interviewUnscored === 1 ? ' was' : 's were'} skipped or could not be evaluated, so there is not enough data to judge this topic yet.` }
  }
  if (evidenceUnits === 0) return { status: 'no_data', score: null, confidence: null, evidence: 'No practice on this topic yet.' }
  if (!signals.length) return { status: 'insufficient_data', score: null, confidence: 'low', evidence: `Only ${evidenceUnits} data point${evidenceUnits === 1 ? '' : 's'} so far - at least ${MIN_EVIDENCE} are needed to judge this topic.` }

  const score = Math.round(signals.reduce((s, x) => s + x.value, 0) / signals.length)
  const status = score < WEAK_BELOW ? 'weak' : score < DEVELOPING_BELOW ? 'developing' : 'strong'
  const confidence = evidenceUnits < 3 ? 'low' : evidenceUnits < 8 ? 'medium' : 'high'
  const evidence = signals.map((s) => (s.source === 'interview answers'
    ? `average answer score ${Math.round(s.value)}/100 over ${s.n} answers`
    : `${codingSolved} of ${s.n} attempted problems solved`)).join('; ')
  return { status, score, confidence, evidence: evidence.charAt(0).toUpperCase() + evidence.slice(1) + '.' }
}

/** Subject groups shown on the knowledge-gap map. Topics not listed fall under "Other". */
const SUBJECT_GROUPS = [
  { subject: 'Data structures & algorithms', topics: ['Arrays', 'Strings', 'Hashing', 'Linked Lists', 'Stack', 'Queue', 'Trees', 'Graphs', 'Recursion', 'Dynamic Programming', 'Sorting', 'Searching'] },
  { subject: 'CS fundamentals', topics: ['OOP', 'DBMS', 'Operating Systems', 'Networking', 'System Design'] },
]

function groupBySubject(topicCards) {
  const known = new Set(SUBJECT_GROUPS.flatMap((g) => g.topics))
  const groups = SUBJECT_GROUPS.map((g) => ({ subject: g.subject, topics: topicCards.filter((t) => g.topics.includes(t.topic)) }))
  const other = topicCards.filter((t) => !known.has(t.topic))
  if (other.length) groups.push({ subject: 'Other', topics: other })
  return groups.filter((g) => g.topics.length)
}

/* ------------------------------ spaced review ------------------------------ */

/** Days to wait before revisiting a topic, by current standing. A simplified Leitner-style ladder. */
function reviewIntervalDays(score) {
  if (score < 50) return 1
  if (score < 70) return 3
  if (score < 85) return 7
  return 14
}

/**
 * Review schedule for one topic: due `interval` days after it was last practised. Computed on read from real
 * timestamps - nothing is stored, so there is no "completed review" state to fall out of sync.
 * Returns null when the topic has no score or no practice date.
 */
function reviewSchedule({ score, lastPracticedAt }, now) {
  if (score == null || !lastPracticedAt) return null
  const interval = reviewIntervalDays(score)
  const dueAt = new Date(new Date(lastPracticedAt).getTime() + interval * DAY_MS)
  const diffDays = Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS)
  return { intervalDays: interval, dueAt: dueAt.toISOString(), isDue: now.getTime() >= dueAt.getTime(), overdueDays: diffDays > 0 ? diffDays : 0 }
}

/* ------------------------------ readiness ------------------------------ */

const READINESS_WEIGHTS = { interview: 0.4, coding: 0.3, coverage: 0.2, consistency: 0.1 }

/**
 * Practice readiness: a transparent weighted average of the components that have enough data.
 *  interview   (40%) mean final score of the latest <= 5 completed practice interviews. Needs >= 1.
 *  coding      (30%) % of distinct attempted problems that were solved. Needs >= 3 distinct problems attempted.
 *  coverage    (20%) % of all topics with at least one practice record.
 *  consistency (10%) active days in the last 14, scaled so 7 or more active days = 100%.
 * Missing components are left out and the remaining weights are re-normalised. With fewer than 2 components the
 * score is null ("not enough data") rather than a number built from almost nothing.
 */
function computeReadiness({ interviewRecentAverage, interviewRecentCount, codingAttempted, codingSolved, topicsPracticed, topicsTotal, activeDaysLast14 }) {
  const comps = [
    {
      key: 'interview', label: 'Recent interview scores', weight: READINESS_WEIGHTS.interview,
      available: interviewRecentCount >= 1 && interviewRecentAverage != null,
      value: interviewRecentAverage != null ? Math.round(interviewRecentAverage) : null,
      detail: interviewRecentCount >= 1 ? `Average of your latest ${interviewRecentCount} completed practice interview${interviewRecentCount === 1 ? '' : 's'}.` : 'Complete a practice interview to include this.',
    },
    {
      key: 'coding', label: 'Coding problems solved', weight: READINESS_WEIGHTS.coding,
      available: codingAttempted >= 3,
      value: codingAttempted >= 3 ? Math.round((100 * codingSolved) / codingAttempted) : null,
      detail: codingAttempted >= 3 ? `${codingSolved} of ${codingAttempted} attempted problems solved.` : `Attempt at least 3 different problems to include this (${codingAttempted} so far).`,
    },
    {
      key: 'coverage', label: 'Topic coverage', weight: READINESS_WEIGHTS.coverage,
      available: topicsTotal > 0 && topicsPracticed >= 1,
      value: topicsTotal > 0 && topicsPracticed >= 1 ? Math.round((100 * topicsPracticed) / topicsTotal) : null,
      detail: `${topicsPracticed} of ${topicsTotal} topics practised at least once.`,
    },
    {
      key: 'consistency', label: 'Practice consistency', weight: READINESS_WEIGHTS.consistency,
      available: activeDaysLast14 >= 1,
      value: activeDaysLast14 >= 1 ? Math.min(100, Math.round((100 * activeDaysLast14) / 7)) : null,
      detail: `${activeDaysLast14} active day${activeDaysLast14 === 1 ? '' : 's'} in the last 14 (7 or more counts as 100%).`,
    },
  ]
  const usable = comps.filter((c) => c.available)
  const limitations = [
    'This is a practice-activity indicator, not a prediction of interview or hiring outcomes.',
    'Weights and thresholds are hand-chosen and have not been validated against real results.',
    'It only reflects practice done in this app, and different interviews have different questions.',
  ]
  if (usable.length < 2) {
    return { score: null, band: null, reason: 'Not enough practice data yet. Complete an interview and attempt a few coding problems to see this.', components: comps, limitations }
  }
  const totalWeight = usable.reduce((s, c) => s + c.weight, 0)
  const score = Math.round(usable.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight)
  const band = score < 40 ? 'Getting started' : score < 70 ? 'Building' : 'Well practised'
  return { score, band, reason: null, basedOn: usable.length, of: comps.length, components: comps, limitations }
}

/* ------------------------------ recommendations ------------------------------ */

/** Coding difficulty to suggest for a topic, from how the candidate has done there. */
function suggestedDifficulty({ codingAttempted = 0, codingSolved = 0 }) {
  if (codingAttempted < 2) return 'easy'
  const rate = (100 * codingSolved) / codingAttempted
  if (rate < 50) return 'easy'
  if (rate < 80 || codingAttempted < 4) return 'medium'
  return 'hard'
}

const DIFFICULTY_ORDER = ['easy', 'medium', 'hard']

/** Picks the unsolved problem closest to the wanted difficulty (preferring the exact one). */
function pickProblem(problems, wanted) {
  if (!problems.length) return null
  const rank = (p) => Math.abs(DIFFICULTY_ORDER.indexOf(p.difficulty) - DIFFICULTY_ORDER.indexOf(wanted))
  return [...problems].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0]
}

/**
 * Ordered "what to do next" list (max 5) from real facts only. Each item says why it was suggested.
 * @param ctx { inProgress, dueReviews[], goals, progress, weakTopics[], suggestedProblems[], hasAnyActivity, hasProfileSkills }
 */
function recommendNextSteps(ctx) {
  const out = []
  if (ctx.inProgress) out.push({ id: 'continue', type: 'continue', title: `Continue your ${ctx.inProgress.targetRole} interview`, reason: 'You have an interview in progress.', link: `/interview/${ctx.inProgress.id}` })
  for (const r of (ctx.dueReviews || []).slice(0, 2)) {
    out.push({ id: `review-${r.topic}`, type: 'review', title: `Review ${r.topic}`, reason: `Last practised ${r.lastPracticedDaysAgo} day${r.lastPracticedDaysAgo === 1 ? '' : 's'} ago; your standing there is ${r.status} (${r.score}%), so it is due for another look.`, link: '/interview/setup' })
  }
  const g = ctx.goals; const p = ctx.progress
  if (g && p) {
    if (g.weeklyInterviews > 0 && p.interviews < g.weeklyInterviews) out.push({ id: 'goal-interviews', type: 'goal', title: 'Do a practice interview', reason: `${p.interviews} of ${g.weeklyInterviews} weekly interviews done.`, link: '/interview/setup' })
    if (g.weeklyProblems > 0 && p.problems < g.weeklyProblems) out.push({ id: 'goal-problems', type: 'goal', title: 'Solve a coding problem', reason: `${p.problems} of ${g.weeklyProblems} weekly problems solved.`, link: '/coding' })
  }
  for (const pr of (ctx.suggestedProblems || []).slice(0, 2)) {
    out.push({ id: `problem-${pr.id}`, type: 'coding', title: `Try "${pr.title}"`, reason: pr.reason, link: `/coding/${pr.id}` })
  }
  if (!ctx.hasAnyActivity) {
    out.length = 0
    out.push({ id: 'first-interview', type: 'start', title: 'Start your first practice interview', reason: 'Nothing recorded yet - one interview unlocks your score trend and topic map.', link: '/interview/setup' })
    out.push({ id: 'first-problem', type: 'start', title: 'Solve your first coding problem', reason: 'Start with an easy problem to see how test results work.', link: '/coding' })
    if (!ctx.hasProfileSkills) out.push({ id: 'profile', type: 'start', title: 'Add your skills to your profile', reason: 'Skills tailor the questions you are asked.', link: '/profile' })
  }
  return out.slice(0, 5)
}

module.exports = {
  DAY_MS, dayKey, weekStartUtc, computeStreaks, buildHeatmap, classifyTopic, groupBySubject, SUBJECT_GROUPS,
  reviewIntervalDays, reviewSchedule, computeReadiness, READINESS_WEIGHTS, suggestedDifficulty, pickProblem, recommendNextSteps,
}
