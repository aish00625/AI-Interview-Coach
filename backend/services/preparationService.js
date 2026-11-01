const model = require('../models/preparationModel')
const dashboardModel = require('../models/dashboardModel')
const prep = require('../utils/preparation')

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const round1 = (n) => Math.round(n * 10) / 10
const daysBetween = (a, b) => Math.max(0, Math.floor((a.getTime() - new Date(b).getTime()) / prep.DAY_MS))

const METHODOLOGY = [
  'Everything here is computed from your own practice records in this app (hiring assessments are never included).',
  'Topic standing = the average of your interview answer scores and the share of attempted coding problems you solved, once at least 2 data points exist. Below 50 is weak, below 70 developing, 70 or more strong.',
  'Review dates follow a simple ladder from your last practice: 1 day if weak, 3 if developing, 7 if good, 14 if strong. They are suggestions, not a proven memory model.',
  'Weeks run Monday to Sunday in UTC. Streaks count days (UTC) with at least one answer or code submission.',
  'All thresholds and weights are hand-chosen heuristics that have not been validated against real interview results.',
]

/**
 * Everything the candidate Dashboard needs in one round trip, derived from the caller's own practice data.
 * `now` is injectable for tests.
 */
async function getPreparation(userId, now = new Date()) {
  const weekStart = prep.weekStartUtc(now)
  const [overview, scoreOverTime, recentActivity, topicStats, activity, recent, inProgress, weekly, goals, coverage, languages, hasSkills] = await Promise.all([
    dashboardModel.getOverviewCounts(userId),
    dashboardModel.getScoreOverTime(userId, 10),
    dashboardModel.getRecentActivity(userId, 6),
    model.getTopicStats(userId),
    model.getActivityDays(userId),
    model.getRecentInterviewAverage(userId, 5),
    model.getInProgressInterview(userId),
    model.getWeeklyProgress(userId, weekStart),
    model.getGoals(userId),
    model.getCodingCoverageByDifficulty(userId),
    dashboardModel.getCodingByLanguage(userId),
    model.hasProfileSkills(userId),
  ])

  const hasAnyActivity = overview.totalInterviews > 0 || overview.totalCodingSubmissions > 0

  // ---- topic cards + knowledge-gap map
  const cards = topicStats.map((t) => {
    const c = prep.classifyTopic(t)
    const review = prep.reviewSchedule({ score: c.score, lastPracticedAt: t.lastPracticedAt }, now)
    return {
      topicId: t.topicId, topic: t.topic, status: c.status, score: c.score, confidence: c.confidence, evidence: c.evidence,
      interviewAnswers: t.interviewAnswers, interviewUnscored: t.interviewUnscored || 0, codingAttempted: t.codingAttempted, codingSolved: t.codingSolved,
      lastPracticedAt: t.lastPracticedAt, review,
    }
  })
  const gapMap = { subjects: prep.groupBySubject(cards), thresholds: { weakBelow: 50, developingBelow: 70, minimumDataPoints: 2 } }

  // ---- spaced review (computed on read)
  const withReview = cards.filter((c) => c.review)
  const due = withReview.filter((c) => c.review.isDue).sort((a, b) => b.review.overdueDays - a.review.overdueDays || a.score - b.score)
  const upcoming = withReview.filter((c) => !c.review.isDue).sort((a, b) => new Date(a.review.dueAt) - new Date(b.review.dueAt)).slice(0, 3)
  const reviewShape = (c) => ({ topic: c.topic, status: c.status, score: c.score, lastPracticedAt: c.lastPracticedAt, lastPracticedDaysAgo: daysBetween(now, c.lastPracticedAt), ...c.review })
  const reviewQueue = due.slice(0, 6).map(reviewShape)
  const upcomingReviews = upcoming.map(reviewShape)

  // ---- streak, heatmap, consistency
  const activityDays = activity.map((a) => a.day)
  const streak = prep.computeStreaks(activityDays, now)
  const cutoff14 = prep.dayKey(new Date(now.getTime() - 13 * prep.DAY_MS))
  const activeDaysLast14 = activityDays.filter((d) => d >= cutoff14).length
  const heatCells = prep.buildHeatmap(activity, now, 84)
  const heatmap = { days: heatCells, totalActions: heatCells.reduce((s, c) => s + c.count, 0), activeDays: heatCells.filter((c) => c.count > 0).length, windowDays: 84 }

  // ---- readiness
  const codingAttempted = coverage.reduce((s, c) => s + c.attempted, 0)
  const codingSolved = coverage.reduce((s, c) => s + c.solved, 0)
  const readiness = prep.computeReadiness({
    interviewRecentAverage: recent.average, interviewRecentCount: recent.count,
    codingAttempted, codingSolved,
    topicsPracticed: cards.filter((c) => c.interviewAnswers + c.codingAttempted > 0).length, topicsTotal: cards.length,
    activeDaysLast14,
  })

  // ---- suggested coding problems (unsolved, difficulty matched to how you are doing in that topic)
  const standing = cards.filter((c) => c.status === 'weak' || c.status === 'developing').sort((a, b) => a.score - b.score)
  const unexplored = cards.filter((c) => (c.status === 'no_data' || c.status === 'insufficient_data') && prep.SUBJECT_GROUPS[0].topics.includes(c.topic))
  const targets = [...standing, ...unexplored].slice(0, 3)
  const unsolved = await model.getUnsolvedProblems(userId, targets.map((t) => t.topicId))
  const suggestedProblems = []
  for (const t of targets) {
    const wanted = prep.suggestedDifficulty({ codingAttempted: t.codingAttempted, codingSolved: t.codingSolved })
    const pick = prep.pickProblem(unsolved.filter((p) => p.topicId === t.topicId), wanted)
    if (!pick) continue
    const why = t.codingAttempted > 0
      ? `${t.topic}: ${t.codingSolved} of ${t.codingAttempted} attempted problems solved (${t.status}), so a ${wanted} problem is a sensible next step.`
      : `No coding practice on ${t.topic} yet, so starting with a ${wanted} problem.`
    suggestedProblems.push({ id: pick.id, title: pick.title, difficulty: pick.difficulty, topic: pick.topic, reason: why })
  }

  // ---- goals
  const progress = weekly
  const goalBlock = {
    current: goals ? { weeklyInterviews: goals.weeklyInterviews, weeklyProblems: goals.weeklyProblems } : null,
    progress, weekStart: weekStart.toISOString(), weekEnd: new Date(weekStart.getTime() + 7 * prep.DAY_MS).toISOString(),
  }

  const nextSteps = prep.recommendNextSteps({
    inProgress, dueReviews: reviewQueue, goals: goals || null, progress, suggestedProblems, hasAnyActivity, hasProfileSkills: hasSkills,
  })

  const codingSuccessRate = overview.totalCodingSubmissions > 0 ? round1((overview.passedCodingSubmissions / overview.totalCodingSubmissions) * 100) : null
  return {
    generatedAt: now.toISOString(),
    hasAnyActivity,
    overview: { ...overview, codingSuccessRate, distinctProblemsAttempted: codingAttempted, distinctProblemsSolved: codingSolved },
    readiness, streak: { ...streak, activeDaysLast14 },
    goals: goalBlock, heatmap, gapMap, reviewQueue, upcomingReviews,
    coding: {
      byDifficulty: coverage, byLanguage: languages,
      topicSuccess: cards.filter((c) => c.codingAttempted > 0).map((c) => ({ topic: c.topic, attempted: c.codingAttempted, solved: c.codingSolved, rate: Math.round((100 * c.codingSolved) / c.codingAttempted) })),
    },
    scoreOverTime, recentActivity, continueInterview: inProgress, suggestedProblems, nextSteps,
    methodology: METHODOLOGY,
  }
}

/** Server-side check (express-validator also runs on the route): whole numbers within the stored limits. */
async function setGoals(userId, { weeklyInterviews, weeklyProblems }) {
  const ok = (v, max) => Number.isInteger(v) && v >= 0 && v <= max
  if (!ok(weeklyInterviews, 50)) throw httpError(400, 'weeklyInterviews must be a whole number from 0 to 50.')
  if (!ok(weeklyProblems, 200)) throw httpError(400, 'weeklyProblems must be a whole number from 0 to 200.')
  return model.upsertGoals(userId, { weeklyInterviews, weeklyProblems })
}

/** This completed practice interview against the previous one of the same type and role (the caller's own sessions only). */
async function getInterviewComparison(userId, sessionId) {
  const pair = await model.getComparisonSessions(userId, sessionId)
  if (!pair) throw httpError(404, 'Completed practice interview not found.')
  const { current, previous } = pair
  const brief = (s) => ({ id: s.id, finalScore: s.finalScore, completedAt: s.completedAt, difficulty: s.difficulty, answers: s.dimensions.answers })
  const note = 'The two interviews may have asked different questions, so treat differences as a rough trend rather than an exact measure.'
  if (!previous) {
    return { available: false, reason: 'This is your first completed practice interview of this type and role, so there is nothing to compare with yet.', current: brief(current), note }
  }
  const diff = (a, b) => (a == null || b == null ? null : round1(a - b))
  const dims = ['technical', 'relevance', 'clarity', 'completeness'].map((k) => ({ dimension: k, current: current.dimensions[k] == null ? null : round1(current.dimensions[k]), previous: previous.dimensions[k] == null ? null : round1(previous.dimensions[k]), change: diff(current.dimensions[k], previous.dimensions[k]) }))
  const topics = [...current.topicScores.keys()].filter((t) => previous.topicScores.has(t)).map((t) => ({ topic: t, current: round1(current.topicScores.get(t)), previous: round1(previous.topicScores.get(t)), change: diff(current.topicScores.get(t), previous.topicScores.get(t)) }))
  return { available: true, current: brief(current), previous: brief(previous), scoreChange: diff(current.finalScore, previous.finalScore), dimensions: dims, topics, note }
}

module.exports = { getPreparation, setGoals, getInterviewComparison, METHODOLOGY }
