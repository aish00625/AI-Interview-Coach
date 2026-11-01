const { sendSuccess, sendError } = require('../utils/apiResponse')
const profileModel = require('../models/profileModel')
const profileService = require('../services/profileService')

/**
 * Phase 5: "the current user" now comes from req.user.userId, set by
 * middleware/auth.js after verifying the JWT — never from a client-
 * supplied id (query string or body), so one user can't read or write
 * another user's profile.
 */

async function getProfile(req, res, next) {
  try {
    const userId = req.user.userId
    const profile = await profileModel.getProfileByUserId(userId)
    if (!profile) return sendError(res, 'Profile not found for this user.', 404)

    const skills = await profileModel.getUserSkills(userId)
    sendSuccess(res, { ...profile, skills })
  } catch (err) {
    next(err)
  }
}

async function updateProfile(req, res, next) {
  try {
    const userId = req.user.userId
    const { targetRole, experienceLevel, preferredLanguage, skillNames } = req.body

    const { profile, skills } = await profileService.upsertProfileWithSkills(userId, {
      targetRole, experienceLevel, preferredLanguage, skillNames,
    })
    sendSuccess(res, { ...profile, skills })
  } catch (err) {
    next(err)
  }
}

module.exports = { getProfile, updateProfile }
