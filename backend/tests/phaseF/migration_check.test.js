const test = require('node:test')
const assert = require('node:assert/strict')
const { findMissingMigrations, REQUIRED_MIGRATIONS } = require('../../utils/migrationCheck')

test('reports exactly the migrations that are not recorded', async () => {
  const pool = { query: async () => ({ rows: REQUIRED_MIGRATIONS.slice(0, 3).map((version) => ({ version })) }) }
  assert.deepEqual(await findMissingMigrations(pool), REQUIRED_MIGRATIONS.slice(3))
})
test('nothing missing when all are applied', async () => {
  const pool = { query: async () => ({ rows: REQUIRED_MIGRATIONS.map((version) => ({ version })) }) }
  assert.deepEqual(await findMissingMigrations(pool), [])
})
test('a database without schema_migrations (never migrated) reports everything missing', async () => {
  const pool = { query: async () => { const e = new Error('no table'); e.code = '42P01'; throw e } }
  assert.deepEqual(await findMissingMigrations(pool), REQUIRED_MIGRATIONS)
})
test('connection errors propagate (server logs a warning and keeps the old behaviour)', async () => {
  const pool = { query: async () => { const e = new Error('refused'); e.code = 'ECONNREFUSED'; throw e } }
  await assert.rejects(findMissingMigrations(pool), { code: 'ECONNREFUSED' })
})
