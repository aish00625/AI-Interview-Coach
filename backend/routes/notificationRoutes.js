const express = require('express')
const controller = require('../controllers/notificationController')
const { requireAuth } = require('../middleware/auth')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, notificationQuery } = require('../middleware/validators')

const router = express.Router()

// Any signed-in user; every query is scoped to req.user.userId in SQL, so ids of other users' notifications are 404.
router.use(requireAuth)

router.get('/', notificationQuery, handleValidationErrors, controller.list)
router.get('/unread-count', controller.unreadCount)
router.post('/read-all', controller.markAllRead)
router.post('/:id/read', idParam('id'), handleValidationErrors, controller.markRead)

module.exports = router
