const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')

const notFound = require('./middleware/notFound')
const errorHandler = require('./middleware/errorHandler')
const { checkConnection } = require('./config/db')

const authRoutes = require('./routes/authRoutes')
const userRoutes = require('./routes/userRoutes')
const interviewRoutes = require('./routes/interviewRoutes')
const codingRoutes = require('./routes/codingRoutes')
const dashboardRoutes = require('./routes/dashboardRoutes')
const performanceRoutes = require('./routes/performanceRoutes')
const skillRoutes = require('./routes/skillRoutes')
const topicRoutes = require('./routes/topicRoutes')
const adminRoutes = require('./routes/adminRoutes')
const hirerJobRoutes = require('./routes/hirerJobRoutes')
const jobRoutes = require('./routes/jobRoutes')
const hirerCatalogRoutes = require('./routes/hirerCatalogRoutes')
const hirerApplicationRoutes = require('./routes/hirerApplicationRoutes')
const resumeRoutes = require('./routes/resumeRoutes')
const applicationRoutes = require('./routes/applicationRoutes')
const hirerTeamRoutes = require('./routes/hirerTeamRoutes')
const hirerAuditRoutes = require('./routes/hirerAuditRoutes')
const notificationRoutes = require('./routes/notificationRoutes')
const accountRoutes = require('./routes/accountRoutes')
const faceMonitorRoutes = require('./routes/faceMonitorRoutes')
const hirerAssessmentRoutes = require('./routes/hirerAssessmentRoutes')
const questionBankRoutes = require('./routes/questionBankRoutes')
const candidateAssessmentRoutes = require('./routes/candidateAssessmentRoutes')

const app = express()

/* ------------------------------------------------------------------
 * Security & parsing middleware
 * ------------------------------------------------------------------ */
app.use(helmet())

// Only the configured frontend origin may call this API — never "*".
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  }),
)

app.use(express.json({ limit: '1mb' })) // body size cap — coding submissions are text, not files
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// General API rate limit. Endpoints that need stricter limits (e.g. login,
// once Phase 5 exists) can layer an additional limiter on just that route.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.API_MAX_PER_15MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api', apiLimiter)

/* ------------------------------------------------------------------
 * Health check — no auth, no database dependency
 * ------------------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  // Deliberately not using sendSuccess() here: the spec calls for
  // { success, message } at the top level for this one endpoint,
  // rather than the { success, data } shape used everywhere else.
  res.status(200).json({ success: true, message: 'AI Interview Coach API is running' })
})

// Separate from /api/health on purpose: the app can be "up" (Express
// listening, no DB needed) while PostgreSQL is down. This endpoint is the
// only place that actually checks the database, and it never throws —
// checkConnection() catches its own errors — so a DB outage can't crash
// the process or take down every other route.
app.get('/api/health/db', async (req, res) => {
  const result = await checkConnection()
  if (result.ok) {
    res.status(200).json({ success: true, message: 'Database connection successful' })
  } else {
    res.status(503).json({ success: false, message: 'Database connection failed' })
  }
})

/* ------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------ */
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/interviews', interviewRoutes)
app.use('/api/coding', codingRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/performance', performanceRoutes)
app.use('/api/skills', skillRoutes)
app.use('/api/topics', topicRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/hirer/team', hirerTeamRoutes)
app.use('/api/hirer/audit-log', hirerAuditRoutes)
app.use('/api/hirer/assessments', hirerAssessmentRoutes)
app.use('/api/hirer/question-bank', questionBankRoutes)
app.use('/api/hirer/jobs', hirerJobRoutes)
app.use('/api/hirer', hirerApplicationRoutes)
app.use('/api/hirer/coding-problems', hirerCatalogRoutes)
app.use('/api/jobs', jobRoutes)
app.use('/api/resumes', resumeRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/account', accountRoutes)
app.use('/api/face-monitoring', faceMonitorRoutes)
app.use('/api/assessments', candidateAssessmentRoutes)

/* ------------------------------------------------------------------
 * 404 + centralized error handling — must be registered last, in order
 * ------------------------------------------------------------------ */
app.use(notFound)
app.use(errorHandler)

module.exports = app
