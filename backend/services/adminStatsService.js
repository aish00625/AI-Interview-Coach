const model = require('../models/adminStatsModel')
const aiClient = require('./aiServiceClient')
const executorClient = require('./codeExecutorClient')

async function getOverview() {
  return { generatedAt: new Date().toISOString(), ...(await model.getOverview()) }
}

/**
 * Live reachability of the services this app depends on. Each probe is time-limited and never throws: an unreachable
 * service is reported as unreachable, not hidden. The code-executor's /health only proves the executor process is up;
 * it does not report whether the Docker daemon behind it works, and this response says so rather than implying it.
 */
const attempt = async (fn, fallback) => { try { return await fn() } catch { return fallback } }

async function getServiceHealth() {
  const [database, ai, executor] = await Promise.all([
    attempt(async () => ({ ok: true, ...(await model.getDatabaseStatus()) }), { ok: false }),
    attempt(() => aiClient.getCapabilities(), { reachable: false, reason: 'ai_service_unreachable' }),
    attempt(() => executorClient.getHealth(), { configured: true, reachable: false }),
  ])
  return {
    checkedAt: new Date().toISOString(),
    database,
    aiService: ai,
    codeExecutor: { ...executor, note: 'Reachability of the executor process only. Docker availability behind it is verified when a submission runs.' },
  }
}

module.exports = { getOverview, getServiceHealth }
