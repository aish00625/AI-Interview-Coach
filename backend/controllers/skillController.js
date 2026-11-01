const { sendSuccess } = require('../utils/apiResponse')
const skillModel = require('../models/skillModel')

async function getAllSkills(req, res, next) {
  try {
    const skills = await skillModel.getAllSkills()
    sendSuccess(res, skills)
  } catch (err) {
    next(err)
  }
}

module.exports = { getAllSkills }
