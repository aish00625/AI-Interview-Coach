const { sendSuccess } = require('../utils/apiResponse')
const authService = require('../services/authService')

async function register(req, res, next) {
  try {
    const { name, email, password, role, companyName, inviteToken } = req.body
    const { token, user } = await authService.registerUser({ name, email, password, role, companyName, inviteToken })
    sendSuccess(res, { token, user }, 201)
  } catch (err) {
    next(err)
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body
    const { token, user } = await authService.loginUser({ email, password })
    sendSuccess(res, { token, user })
  } catch (err) {
    next(err)
  }
}

/**
 * JWTs are stateless — there's no server-side session to destroy, so this
 * just confirms the request was authenticated. The frontend doesn't need
 * to call this (removing the token client-side is sufficient), but the
 * route exists and is protected for completeness / future use (e.g. if a
 * token blacklist is ever added).
 */
async function logout(req, res) {
  sendSuccess(res, { message: 'Logged out.' })
}

/** Current user (role + organization read fresh from the database). Used by the frontend to restore a session. */
async function me(req, res, next) {
  try {
    const user = await authService.getCurrentUser(req.user.userId)
    sendSuccess(res, { user })
  } catch (err) {
    next(err)
  }
}

module.exports = { register, login, logout, me }
