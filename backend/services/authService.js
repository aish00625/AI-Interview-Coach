const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const userModel = require('../models/userModel')
const profileModel = require('../models/profileModel')
const organizationModel = require('../models/organizationModel')
const hiringTeamService = require('./hiringTeamService')
const { generateToken } = require('../utils/jwt')

const SALT_ROUNDS = 10

// Self-registration can only create these. 'admin' is never creatable via the API.
const SELF_REGISTER_ROLES = ['candidate', 'hirer']

function toSafeUser(user, organization = null) {
  // Strips password_hash (and anything else not meant for the client)
  // before a user object ever reaches a response.
  const safe = { id: user.id, name: user.name, email: user.email, role: user.role || 'candidate' }
  if (safe.role === 'hirer') {
    safe.organization = organization
      ? { id: organization.id, name: organization.name, status: organization.status, memberRole: organization.member_role }
      : null
  }
  return safe
}

/**
 * Registration: hash the password, then in ONE transaction create the user
 * plus what their role needs:
 *   candidate -> default empty profile (unchanged from before)
 *   hirer     -> a 'pending' organization + owner membership (no candidate profile)
 * and issue a token.
 */
async function registerUser({ name, email, password, role = 'candidate', companyName, inviteToken }) {
  if (!SELF_REGISTER_ROLES.includes(role)) {
    const err = new Error('Invalid account type.')
    err.statusCode = 400
    throw err
  }
  if (inviteToken && role !== 'hirer') {
    const err = new Error('Invitations are for hiring accounts.')
    err.statusCode = 400
    throw err
  }
  if (role === 'hirer' && !inviteToken && !(companyName && companyName.trim())) {
    const err = new Error('Company name is required for hiring accounts.')
    err.statusCode = 400
    throw err
  }

  const existing = await userModel.findUserByEmail(email)
  if (existing) {
    const err = new Error('An account with that email already exists.')
    err.statusCode = 409
    throw err
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const user = await userModel.createUser({ email, passwordHash, name, role }, client)
    let membership = null
    if (role === 'hirer' && inviteToken) {
      // Joining an existing organization by invitation: no new organization, role comes from the invitation.
      const joined = await hiringTeamService.consumeInvitation({ token: inviteToken, email, userId: user.id, client })
      await organizationModel.addMember({ organizationId: joined.organizationId, userId: user.id, memberRole: joined.memberRole }, client)
      const org = await organizationModel.getMembershipByUserId(user.id, client)
      membership = org
    } else if (role === 'hirer') {
      const org = await organizationModel.createOrganization({ name: companyName.trim(), createdBy: user.id }, client)
      await organizationModel.addMember({ organizationId: org.id, userId: user.id, memberRole: 'owner' }, client)
      membership = { id: org.id, name: org.name, status: org.status, member_role: 'owner' }
    } else {
      await profileModel.createProfile(
        { userId: user.id, targetRole: null, experienceLevel: 'fresher', preferredLanguage: 'javascript' },
        client,
      )
    }
    await client.query('COMMIT')

    const token = generateToken({ userId: user.id, email: user.email, role: user.role })
    return { token, user: toSafeUser(user, membership) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Login: deliberately returns the same generic error for "no such email"
 * and "wrong password" — never reveal which one it was.
 */
async function loginUser({ email, password }) {
  const invalidCredentialsError = () => {
    const err = new Error('Invalid email or password.')
    err.statusCode = 401
    return err
  }

  const user = await userModel.findUserByEmail(email)
  if (!user) throw invalidCredentialsError()

  const passwordMatches = await bcrypt.compare(password, user.password_hash)
  if (!passwordMatches) throw invalidCredentialsError()

  const membership = user.role === 'hirer' ? await organizationModel.getMembershipByUserId(user.id) : null
  const token = generateToken({ userId: user.id, email: user.email, role: user.role })
  return { token, user: toSafeUser(user, membership) }
}

/** Current user as stored in the database (role + organization are authoritative here, not in the JWT). */
async function getCurrentUser(userId) {
  const user = await userModel.findUserById(userId)
  if (!user) {
    const err = new Error('Authentication required.')
    err.statusCode = 401
    throw err
  }
  const membership = user.role === 'hirer' ? await organizationModel.getMembershipByUserId(user.id) : null
  return toSafeUser(user, membership)
}

module.exports = { registerUser, loginUser, getCurrentUser }
