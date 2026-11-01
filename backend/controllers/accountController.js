const { sendSuccess } = require('../utils/apiResponse')
const service = require('../services/accountService')

async function exportData(req, res, next) {
  try {
    const data = await service.exportData(req.user.userId)
    res.setHeader('Content-Disposition', 'attachment; filename="my-data-export.json"')
    res.setHeader('Cache-Control', 'no-store')
    sendSuccess(res, data)
  } catch (err) { next(err) }
}
async function remove(req, res, next) {
  try { sendSuccess(res, await service.deleteAccount({ userId: req.user.userId, password: req.body.password })) } catch (err) { next(err) }
}
module.exports = { exportData, remove }
