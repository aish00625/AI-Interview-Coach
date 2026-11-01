const { sendSuccess } = require('../utils/apiResponse')
const dashboardModel = require('../models/dashboardModel')

/**
 * Feeds the Progress page: the deeper interview/coding/topic breakdowns.
 * `performance_scores` exists in the schema but nothing populates it yet
 * (no scoring pipeline writes to it) — everything here is computed
 * directly from interview_sessions/interview_answers/coding_submissions
 * instead. Always scoped to req.user.userId.
 */
async function getPerformance(req, res, next) {
  try {
    const userId = req.user.userId

    const [
      overview, scoreAverages, codingStatus, codingByLanguage, codingByDifficulty,
      scoreOverTime, interviewsByType, interviewsByDifficulty, sessionStatus, topicPerformance,
    ] = await Promise.all([
      dashboardModel.getOverviewCounts(userId),
      dashboardModel.getInterviewScoreAverages(userId),
      dashboardModel.getCodingStatusBreakdown(userId),
      dashboardModel.getCodingByLanguage(userId),
      dashboardModel.getCodingByDifficulty(userId),
      dashboardModel.getScoreOverTime(userId, 10),
      dashboardModel.getInterviewCountsByType(userId),
      dashboardModel.getInterviewCountsByDifficulty(userId),
      dashboardModel.getSessionStatusBreakdown(userId),
      dashboardModel.getTopicPerformance(userId),
    ])

    const codingTotal = codingStatus.pending + codingStatus.passed + codingStatus.failed + codingStatus.error
    // Pass rate stands in for a "coding score" — code_quality_score exists
    // on coding_submissions but nothing currently computes/writes it
    // (Phase 9's executor doesn't produce a quality metric), so using it
    // here would silently be null for every user. Pass rate is the one
    // coding-performance signal we actually have real data for.
    const codingScore = codingTotal > 0 ? Math.round((codingStatus.passed / codingTotal) * 1000) / 10 : null

    // clarity_score is used as the stand-in for "communication" — it's
    // the one existing score dimension about how well an answer was
    // expressed, as opposed to its technical content.
    const communicationScore = scoreAverages.averageClarityScore

    sendSuccess(res, {
      overallScore: overview.averageInterviewScore,
      codingScore,
      technicalInterviewScore: scoreAverages.averageTechnicalScore,
      communicationScore,
      scoreAverages,
      scoreOverTime,
      interviewsByType,
      interviewsByDifficulty,
      sessionStatusBreakdown: sessionStatus,
      codingStatusBreakdown: codingStatus,
      codingByLanguage,
      codingByDifficulty,
      topicPerformance,
      strongestTopics: [...topicPerformance].reverse().slice(0, 3),
      weakestTopics: topicPerformance.slice(0, 3),
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getPerformance }
