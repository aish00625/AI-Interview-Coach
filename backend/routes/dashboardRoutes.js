const express = require('express')
const dashboardController = require('../controllers/dashboardController')
const preparationController = require('../controllers/preparationController')
const localAiController = require('../controllers/localAiController')
const { handleValidationErrors } = require('../middleware/validate')
const { goalsRules } = require('../middleware/validators')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')

const router = express.Router()

router.get('/', requireAuth, requireRole('candidate'), dashboardController.getDashboard)
// Readiness, knowledge-gap map, review queue, streak, heatmap and recommendations - all from the caller's own practice records.
router.get('/preparation', requireAuth, requireRole('candidate'), preparationController.getPreparation)
router.put('/goals', requireAuth, requireRole('candidate'), goalsRules, handleValidationErrors, preparationController.putGoals)

// Local AI model status (for the UI badge) and the rule-based daily practice plan built from the caller's own records.
router.get('/ai-status', requireAuth, requireRole('candidate'), localAiController.getAiStatus)
router.get('/plan', requireAuth, requireRole('candidate'), localAiController.getDailyPlan)

module.exports = router
