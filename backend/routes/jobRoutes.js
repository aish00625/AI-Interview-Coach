const express = require('express')
const jobController = require('../controllers/jobController')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, jobListQuery, jobFitQuery } = require('../middleware/validators')

const router = express.Router()

// Candidate job board: only open, unexpired jobs of approved organizations.
router.use(requireAuth, requireRole('candidate'))

router.get('/', jobListQuery, handleValidationErrors, jobController.listOpen)
router.get('/:id', idParam('id'), handleValidationErrors, jobController.getOpen)
// Private self-check for the signed-in candidate; nothing is stored or shared with the hiring team.
router.get('/:id/fit', idParam('id'), jobFitQuery, handleValidationErrors, jobController.getFit)

module.exports = router
