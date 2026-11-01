const test = require('node:test')
const assert = require('node:assert/strict')
const { checkConfig } = require('../../utils/configCheck')

const good = { JWT_SECRET: 'x'.repeat(48), DATABASE_URL: 'postgres://u:p@h/db', AI_SERVICE_API_KEY: 'a', CODE_EXECUTOR_API_KEY: 'b' }

test('a complete configuration has no errors or warnings', () => {
  assert.deepEqual(checkConfig(good), { errors: [], warnings: [] })
})
test('missing or placeholder JWT_SECRET is a hard error', () => {
  assert.equal(checkConfig({ ...good, JWT_SECRET: '' }).errors.length, 1)
  assert.equal(checkConfig({ ...good, JWT_SECRET: 'change-me' }).errors.length, 1)
  assert.equal(checkConfig({ ...good, JWT_SECRET: 'CHANGEME' }).errors.length, 1)
})
test('short secret and missing service keys are warnings, not errors', () => {
  const r = checkConfig({ ...good, JWT_SECRET: 'short-secret', AI_SERVICE_API_KEY: '', CODE_EXECUTOR_API_KEY: 'change-me' })
  assert.equal(r.errors.length, 0)
  assert.equal(r.warnings.length, 3)
})
