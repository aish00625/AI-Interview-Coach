const express = require('express')
const performanceController = require('../controllers/performanceController')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')

const router = express.Router()

router.get('/', requireAuth, requireRole('candidate'), performanceController.getPerformance)

module.exports = router
