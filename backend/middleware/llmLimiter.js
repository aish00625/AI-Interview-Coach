const rateLimit = require('express-rate-limit')

/** Each local-model request occupies the machine's CPU for seconds, so these routes are limited per user (not per IP). */
const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.LLM_MAX_PER_MINUTE) || 12,
  keyGenerator: (req) => `llm:${req.user?.userId ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You are asking the AI coach too quickly. Please wait a moment and try again.' },
})

module.exports = { llmLimiter }
