const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const userModel = require('../models/userModel')
const model = require('../models/accountModel')
const resumeService = require('./resumeService')

function httpError(statusCode, message) { const e = new Error(message); e.statusCode = statusCode; return e }

const EXPORT_FORMAT = 'ai-interview-coach-export-v1'

/** A copy of the caller's own data as JSON. Contains no password hash and nothing about other users' accounts. */
async function exportData(userId) {
  const user = await userModel.findUserById(userId)
  if (!user) throw httpError(401, 'Authentication required.')
  const data = user.role === 'hirer' ? { hiring: await model.exportHirer(user.id) } : user.role === 'candidate' ? { candidate: await model.exportCandidate(user.id) } : {}
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    account: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.created_at },
    ...data,
    notes: [
      'Resume files are not embedded; their extracted text and metadata are included. Download the originals from "My Resumes" before deleting your account.',
      'AI scores are advisory feedback produced by an automated evaluator.',
    ],
  }
}

/**
 * Permanently deletes the caller's account after re-checking their password.
 *  candidate  applications (and their history, assessments and any hiring-team notes/scorecards about them) are
 *             deleted with the account, then every resume FILE is purged from storage.
 *  hirer      members leave their organization; their notes and scorecards stay with the organization with the
 *             author shown as removed. A sole owner can delete the account only if no candidate has applied to
 *             the organization (otherwise the candidates' records would be orphaned) and no other member would be
 *             left without an owner.
 *  admin      cannot be deleted through the API.
 * The access audit log keeps its rows (user and application references become empty).
 */
async function deleteAccount({ userId, password }) {
  const user = await userModel.findUserById(userId)
  if (!user) throw httpError(401, 'Authentication required.')
  const full = await userModel.findUserByEmail(user.email)
  if (!full || !(await bcrypt.compare(String(password || ''), full.password_hash))) throw httpError(403, 'That password is not correct.')
  if (user.role === 'admin') throw httpError(403, 'Administrator accounts cannot be deleted from the app.')

  const client = await pool.connect()
  let keys = []
  try {
    await client.query('BEGIN')
    // Serialize concurrent deletions of the same account.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id])
    if (user.role === 'hirer') {
      const m = await model.getMembership(user.id, client)
      if (m) {
        const owners = await model.otherOwners(m.organization_id, user.id, client)
        const members = await model.memberCount(m.organization_id, client)
        if (owners.length) {
          await model.reassignCreator({ organizationId: m.organization_id, fromUserId: user.id, toUserId: owners[0].user_id }, client)
        } else if (members > 1) {
          throw httpError(409, 'You are the only owner of an organization with other members. Make another member an owner first.')
        } else if (await model.organizationApplicationCount(m.organization_id, client)) {
          throw httpError(409, 'Your organization still holds candidate applications. Candidates\' records cannot be orphaned, so ask an administrator to remove the organization first.')
        } else {
          await model.deleteOrganization(m.organization_id, client)
        }
      }
      await model.deleteUser(user.id, client)
    } else {
      keys = await model.deleteCandidate(user.id, client)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  // Only after the database commit: files whose rows are gone. Failures here leave orphan files that the
  // reconcile utility reports; they never block or undo the deletion.
  if (keys.length) await resumeService.purgeFiles(keys)
  return { deleted: true, filesRemoved: keys.length }
}

module.exports = { exportData, deleteAccount, EXPORT_FORMAT }
