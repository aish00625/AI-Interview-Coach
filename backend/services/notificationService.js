const model = require('../models/notificationModel')
const { labelFor } = require('../utils/rejectionReasons')

/**
 * In-app notifications (Phase J). Texts are built here from structured data only: a candidate is told the new status
 * and, for a rejection, the neutral reason label. The hiring team's free-text notes are never included.
 */
function statusChangeContent({ jobTitle, organizationName, fromStatus, toStatus, reasonCode }) {
  const where = `${jobTitle} at ${organizationName}`
  switch (toStatus) {
    case 'under_review':
      return fromStatus === 'rejected'
        ? { title: `Your application is being reconsidered: ${where}`, body: 'The hiring team has moved your application back to review.' }
        : { title: `Your application is under review: ${where}`, body: 'The hiring team has started reviewing your application.' }
    case 'shortlisted':
      return { title: `You have been shortlisted: ${where}`, body: 'The hiring team moved your application forward.' }
    case 'rejected':
      return { title: `Update on your application: ${where}`, body: labelFor(reasonCode) || 'The hiring team chose not to continue with this application.' }
    case 'hired':
      return { title: `You have been selected: ${where}`, body: 'The hiring team marked your application as hired.' }
    default:
      return { title: `Your application status changed: ${where}`, body: `New status: ${String(toStatus).replace('_', ' ')}.` }
  }
}

/** Call inside the same transaction as the status change so the two cannot diverge. */
async function notifyStatusChange({ candidateId, applicationId, jobTitle, organizationName, fromStatus, toStatus, reasonCode }, client) {
  const { title, body } = statusChangeContent({ jobTitle, organizationName, fromStatus, toStatus, reasonCode })
  return model.create({ userId: candidateId, type: 'application_status', title, body, applicationId }, client)
}

const list = ({ userId, unreadOnly, limit, before }) => model.listForUser({ userId, unreadOnly: Boolean(unreadOnly), limit: Math.min(Math.max(Number(limit) || 30, 1), 100), before: before || null })
const unreadCount = (userId) => model.unreadCount(userId)

async function markRead({ userId, id }) {
  if (!(await model.markRead({ userId, id }))) { const e = new Error('Notification not found.'); e.statusCode = 404; throw e }
}
const markAllRead = (userId) => model.markAllRead(userId)

module.exports = { statusChangeContent, notifyStatusChange, list, unreadCount, markRead, markAllRead }
