require('dotenv').config()
const app = require('./app')
const { pool } = require('./config/db')
const { findMissingMigrations } = require('./utils/migrationCheck')
const { checkConfig } = require('./utils/configCheck')

const PORT = process.env.PORT || 5000

async function start() {
  const { errors, warnings } = checkConfig()
  warnings.forEach((w) => console.warn(`[config] ${w}`))
  if (errors.length) {
    errors.forEach((e) => console.error(`[config] ${e}`))
    process.exit(1)
  }

  // Refuse to start against a database that is missing required migrations (see database/migrations/README in the setup guide).
  try {
    const missing = await findMissingMigrations(pool)
    if (missing.length) {
      console.error(`\nDatabase is missing migration(s): ${missing.join(', ')}`)
      console.error('Run the SQL files in database/migrations (in numeric order) before starting the API. See the setup guide.\n')
      process.exit(1)
    }
  } catch (err) {
    // Database unreachable: keep the previous behaviour (the API still starts; requests that need the DB will report 503).
    console.warn(`Could not verify database migrations (${err.code || err.message}). Continuing; check DATABASE_URL and that PostgreSQL is running.`)
  }

  app.listen(PORT, () => {
    console.log(`AI Interview Coach API listening on http://localhost:${PORT}`)
    console.log(`Health check: http://localhost:${PORT}/api/health`)
  })
}

start()
