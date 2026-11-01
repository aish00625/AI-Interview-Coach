/**
 * Fail fast on configuration that would otherwise surface later as confusing 500/401/403 errors (or, for a
 * placeholder secret, as a silently insecure deployment). Pure function so it can be unit-tested.
 */
function checkConfig(env = process.env) {
  const errors = []
  const warnings = []
  const secret = env.JWT_SECRET || ''
  if (!secret) errors.push('JWT_SECRET is not set (backend/.env). Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"')
  else if (/^change-?me$/i.test(secret)) errors.push('JWT_SECRET is still the placeholder "change-me". Replace it with a long random value.')
  else if (secret.length < 32) warnings.push('JWT_SECRET is shorter than 32 characters; use a long random value.')
  if (!env.DATABASE_URL) warnings.push('DATABASE_URL is not set; the database connection will use library defaults.')
  for (const k of ['AI_SERVICE_API_KEY', 'CODE_EXECUTOR_API_KEY']) {
    if (!env[k]) warnings.push(`${k} is not set: calls to that service will be rejected (401/403) until it matches the service's own .env.`)
    else if (/^change-?me$/i.test(env[k])) warnings.push(`${k} is still the placeholder "change-me".`)
  }
  return { errors, warnings }
}

module.exports = { checkConfig }
