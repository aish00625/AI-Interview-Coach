const { sendSuccess } = require('../utils/apiResponse')
const service = require('../services/notificationService')

async function list(req, res, next) {
  try {
    const { unread, limit, before } = req.query
    sendSuccess(res, { notifications: await service.list({ userId: req.user.userId, unreadOnly: unread === 'true' || unread === true, limit, before }), unreadCount: await service.unreadCount(req.user.userId) })
  } catch (err) { next(err) }
}
async function unreadCount(req, res, next) {
  try { sendSuccess(res, { unreadCount: await service.unreadCount(req.user.userId) }) } catch (err) { next(err) }
}
async function markRead(req, res, next) {
  try { await service.markRead({ userId: req.user.userId, id: req.params.id }); sendSuccess(res, { read: true, unreadCount: await service.unreadCount(req.user.userId) }) } catch (err) { next(err) }
}
async function markAllRead(req, res, next) {
  try { await service.markAllRead(req.user.userId); sendSuccess(res, { unreadCount: 0 }) } catch (err) { next(err) }
}
module.exports = { list, unreadCount, markRead, markAllRead }
