const express = require('express')
const faceMonitorController = require('../controllers/faceMonitorController')
const { handleValidationErrors } = require('../middleware/validate')
const { idParam, faceSessionRules, faceCameraStatusRules } = require('../middleware/validators')
const { requireAuth } = require('../middleware/auth')
const { requireRole } = require('../middleware/roles')
const { uploadFaceFrame, requireFaceFrame } = require('../middleware/faceFrameUpload')
const { faceFrameLimiter, faceReferenceLimiter } = require('../middleware/faceLimiter')

const router = express.Router()

// Optional, consent-based practice feature for candidates. Role is re-checked against the database on every request, and
// every service call is scoped to the caller's own sessions.
router.use(requireAuth, requireRole('candidate'))

router.get('/capabilities', faceMonitorController.getCapabilities)
router.get('/sessions', faceMonitorController.listSessions)
router.post('/sessions', faceSessionRules, handleValidationErrors, faceMonitorController.createSession)
router.get('/sessions/:id', [idParam()], handleValidationErrors, faceMonitorController.getSession)
router.get('/sessions/:id/report', [idParam()], handleValidationErrors, faceMonitorController.getReport)

// One small camera frame per request (multipart field "frame"), analysed in memory and discarded.
router.post('/sessions/:id/frames', [idParam()], handleValidationErrors, faceFrameLimiter, uploadFaceFrame.single('frame'), requireFaceFrame, faceMonitorController.submitFrame)
router.post('/sessions/:id/reference', [idParam()], handleValidationErrors, faceReferenceLimiter, uploadFaceFrame.single('frame'), requireFaceFrame, faceMonitorController.captureReference)
router.post('/sessions/:id/camera-status', [idParam(), ...faceCameraStatusRules], handleValidationErrors, faceMonitorController.cameraStatus)
router.post('/sessions/:id/pause', [idParam()], handleValidationErrors, faceMonitorController.pause)
router.post('/sessions/:id/resume', [idParam()], handleValidationErrors, faceMonitorController.resume)
router.post('/sessions/:id/end', [idParam()], handleValidationErrors, faceMonitorController.end)
router.delete('/sessions/:id', [idParam()], handleValidationErrors, faceMonitorController.remove)

module.exports = router
