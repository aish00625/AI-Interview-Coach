const express = require('express')
const rateLimit = require('express-rate-limit')
const resumeController = require('../controllers/resumeController')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam } = require('../middleware/validators')
const { uploadResume } = require('../middleware/resumeUpload')

const router = express.Router()

// Uploads are the most expensive endpoint (parsing + disk): tighter per-IP cap than the general API limiter.
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false })

// A candidate's own resumes only; every query is also scoped by user id in SQL.
router.use(requireAuth, requireRole('candidate'))

router.get('/', resumeController.list)
router.post('/', uploadLimiter, uploadResume, resumeController.upload)
router.get('/:id', idParam('id'), handleValidationErrors, resumeController.get)
router.get('/:id/skills', idParam('id'), handleValidationErrors, resumeController.suggestSkills)
router.get('/:id/download', idParam('id'), handleValidationErrors, resumeController.download)
router.delete('/:id', idParam('id'), handleValidationErrors, resumeController.remove)

module.exports = router
