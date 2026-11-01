const { sendSuccess } = require('../utils/apiResponse')
const topicModel = require('../models/topicModel')

async function getAllTopics(req, res, next) {
  try {
    const topics = await topicModel.getAllTopics()
    sendSuccess(res, topics)
  } catch (err) {
    next(err)
  }
}

module.exports = { getAllTopics }
