const { sendSuccess } = require('../utils/apiResponse')
const dashboardModel = require('../models/dashboardModel')

/**
 * Feeds the main Dashboard page: overview counts, a short score trend,
 * a merged recent-activity feed, and up to 3 "weakest topic" suggestions
 * (only populated when there's actual scored data for that topic — never
 * a fabricated suggestion). Always scoped to req.user.userId.
 */
async function getDashboard(req, res, next) {
  try {
    const userId = req.user.userId

    const [overview, scoreOverTime, recentActivity, topicPerformance] = await Promise.all([
      dashboardModel.getOverviewCounts(userId),
      dashboardModel.getScoreOverTime(userId, 10),
      dashboardModel.getRecentActivity(userId, 8),
      dashboardModel.getTopicPerformance(userId),
    ])

    const codingSuccessRate = overview.totalCodingSubmissions > 0
      ? Math.round((overview.passedCodingSubmissions / overview.totalCodingSubmissions) * 1000) / 10
      : null

    // Weakest-first ordering already comes from the model query — just take the bottom few.
    const recommendedTopics = topicPerformance.slice(0, 3).map((t) => ({
      topic: t.topic,
      reason: `Average score ${t.averageScore}% across ${t.answerCount} answer${t.answerCount === 1 ? '' : 's'}`,
    }))

    sendSuccess(res, {
      overview: { ...overview, codingSuccessRate },
      scoreOverTime,
      recentActivity,
      recommendedTopics,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getDashboard }
