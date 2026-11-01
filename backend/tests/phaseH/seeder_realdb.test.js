// Phase H: seeding the problem bank into PostgreSQL (needs AIC_TEST_DB with migrations applied, including 007).
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { root, stubModule } = require('../phaseA/helpers')
const makePool = require('../helpers/pgshim')

const db = process.env.AIC_TEST_DB
if (!db) { test('Phase H seeder', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const testPool = makePool({ db, port: process.env.AIC_TEST_PORT || 55432, host: process.env.AIC_TEST_HOST || '/tmp' })
  test.after(async () => { await testPool.query('DELETE FROM coding_problems WHERE slug IS NOT NULL AND id NOT IN (SELECT problem_id FROM coding_submissions)'); testPool.closeAll() })
  stubModule('config/db', { pool: testPool })
  const { seedProblems } = require(path.join(root, 'utils/problemSeeder.js'))
  const { loadProblemBank } = require(path.join(root, 'utils/problemBank.js'))
  const codingModel = require(path.join(root, 'models/codingModel.js'))
  const bank = loadProblemBank()
  const count = async (where = 'slug IS NOT NULL') => Number((await testPool.query(`SELECT count(*)::int AS n FROM coding_problems WHERE ${where}`)).rows[0].n)
  let before

  test('first run inserts every problem with its topic, tests, examples and hints', async () => {
    await testPool.query('DELETE FROM coding_problems WHERE slug IS NOT NULL AND id NOT IN (SELECT problem_id FROM coding_submissions)')
    await testPool.query("INSERT INTO coding_problems (title, description, difficulty) VALUES ('Hand made problem', 'created by an admin', 'easy')")
    before = await count('slug IS NULL')
    const r = await seedProblems(testPool, bank)
    assert.deepEqual(r, { inserted: bank.length, updated: 0, skipped: 0 })
    const row = (await testPool.query("SELECT cp.*, t.name AS topic FROM coding_problems cp JOIN topics t ON t.id = cp.topic_id WHERE cp.slug = 'min-coins'")).rows[0]
    const p = bank.find((x) => x.slug === 'min-coins')
    assert.equal(row.topic, p.topic); assert.equal(row.test_cases.length, p.tests.length); assert.equal(row.hints.length, 3)
    assert.deepEqual(row.test_cases, p.tests); assert.deepEqual(row.examples, p.examples.map((e) => ({ ...e })))
    assert.ok(row.test_cases.some((t) => t.is_hidden) && row.test_cases.some((t) => !t.is_hidden))
  })

  test('re-running is a no-op; --update refreshes seeded rows only; hand-made problems are never touched', async () => {
    const again = await seedProblems(testPool, bank)
    assert.deepEqual(again, { inserted: 0, updated: 0, skipped: bank.length })
    await testPool.query("UPDATE coding_problems SET title = 'Edited by an admin' WHERE slug = 'min-coins'")
    assert.equal((await seedProblems(testPool, bank)).updated, 0, 'plain re-run leaves local edits alone')
    assert.equal((await testPool.query("SELECT title FROM coding_problems WHERE slug = 'min-coins'")).rows[0].title, 'Edited by an admin')
    const upd = await seedProblems(testPool, bank, { update: true })
    assert.equal(upd.updated, bank.length)
    assert.equal((await testPool.query("SELECT title FROM coding_problems WHERE slug = 'min-coins'")).rows[0].title, bank.find((x) => x.slug === 'min-coins').title)
    assert.equal(await count('slug IS NULL'), before, 'problems without a slug are untouched')
    assert.equal((await testPool.query("SELECT description FROM coding_problems WHERE title = 'Hand made problem'")).rows[0].description, 'created by an admin')
  })

  test('a failure rolls the whole seed back (nothing half-inserted)', async () => {
    await testPool.query("DELETE FROM coding_problems WHERE slug = 'edit-distance'")
    const broken = bank.map((p) => (p.slug === 'edit-distance' ? { ...p, topic: 'No Such Topic' } : p))
    const n = await count()
    await testPool.query("DELETE FROM coding_problems WHERE slug = 'count-islands'")
    await assert.rejects(seedProblems(testPool, broken), /No Such Topic/)
    assert.equal(await count(), n - 1, 'the earlier insert in the failed run was rolled back')
    const ok = await seedProblems(testPool, bank)
    assert.equal(ok.inserted, 2)
  })

  test('the candidate-facing queries never return test cases or hints', async () => {
    const list = await codingModel.getAllProblems({})
    const detail = await codingModel.getProblemById(list.find((p) => p.title === bank.find((x) => x.slug === 'min-coins').title).id)
    for (const row of [...list, detail]) {
      const text = JSON.stringify(row)
      assert.ok(!('test_cases' in row) && !('hints' in row) && !('slug' in row), 'no internal columns')
      assert.ok(!text.includes('expected_output'), 'no expected outputs')
    }
    assert.ok(detail.examples.length >= 1)
  })

  test('seeded test cases map to { input, expectedOutput } exactly as codingService does', async () => {
    const raw = await codingModel.getProblemTestCases((await testPool.query("SELECT id FROM coding_problems WHERE slug = 'two-sum-indices'")).rows[0].id)
    const mapped = raw.map((tc) => ({ input: tc.input ?? '', expectedOutput: tc.expected_output ?? '' }))
    assert.equal(mapped.length, bank.find((x) => x.slug === 'two-sum-indices').tests.length)
    assert.ok(mapped.length <= 20 && mapped.every((m) => m.input && m.expectedOutput))
  })
}
