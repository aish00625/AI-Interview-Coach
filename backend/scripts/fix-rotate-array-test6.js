#!/usr/bin/env node
/**
 * One-off, approved correction: Rotate Array (coding_problems.id = 35, slug 'rotate-array'), hidden test #6 (array index 5).
 * Old: input "6 1000000001\n1 2 3 4 5 6\n" -> "2 3 4 5 6 1"   (k is 1 above the stated maximum of 10^9)
 * New: input "6 1000000000\n1 2 3 4 5 6\n" -> "3 4 5 6 1 2"   (k = the maximum; 10^9 mod 6 = 4)
 *   node scripts/fix-rotate-array-test6.js --dry-run   # READ-ONLY: runs every pre-check on the database and the file, writes nothing
 *   node scripts/fix-rotate-array-test6.js             # apply (database row + data/coding-problems/rotate-array/tests.json)
 * Safety:
 *   - Changes at most 1 database row (id 35) and 1 file. Statement, constraints, examples, hints and every other problem are untouched.
 *   - Database: ONE transaction; refuses unless id 35 / slug / title match and the ten stored tests are exactly the audited ones.
 *     The UPDATE is conditional on test #6's current input, expected output and hidden flag. After it, the other nine tests,
 *     every other column of the row and every other problem row must be identical, or everything is rolled back.
 *   - File: edits only the two string values of test #6 in place (all other bytes unchanged), verifies by parsing and by
 *     reversing the edit, and is written BEFORE the database commit; if anything fails the file is restored and the database
 *     rolled back.
 * Prints no secrets.
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { pool } = require('../config/db')

const ID = 35, SLUG = 'rotate-array', TITLE = 'Rotate Array', IDX = 5
const FILE = path.join(__dirname, '..', 'data', 'coding-problems', 'rotate-array', 'tests.json')
const OLD = { input: '6 1000000001\n1 2 3 4 5 6\n', expected_output: '2 3 4 5 6 1', is_hidden: true }
const NEW = { input: '6 1000000000\n1 2 3 4 5 6\n', expected_output: '3 4 5 6 1 2', is_hidden: true }
const BEFORE = [
  { input: '5 2\n1 2 3 4 5\n', is_hidden: false, expected_output: '4 5 1 2 3' },
  { input: '3 4\n1 2 3\n', is_hidden: false, expected_output: '3 1 2' },
  { input: '1 5\n7\n', is_hidden: false, expected_output: '7' },
  { input: '4 0\n1 2 3 4\n', is_hidden: true, expected_output: '1 2 3 4' },
  { input: '4 4\n1 2 3 4\n', is_hidden: true, expected_output: '1 2 3 4' },
  { ...OLD },
  { input: '2 1\n-5 9\n', is_hidden: true, expected_output: '9 -5' },
  { input: '7 3\n10 20 30 40 50 60 70\n', is_hidden: true, expected_output: '50 60 70 10 20 30 40' },
  { input: '5 10\n0 0 1 0 0\n', is_hidden: true, expected_output: '0 0 1 0 0' },
  { input: '8 13\n-70 -19 28 31 65 -74 -43 53\n', is_hidden: true, expected_output: '31 65 -74 -43 53 -70 -19 28' },
]
const AFTER = BEFORE.map((t, i) => (i === IDX ? { ...NEW } : t))
const same = (a, b, msg) => { if (a !== b) throw new Error(msg) }   // plain message, no data dump
const dryRun = process.argv.includes('--dry-run')
const norm = (tests) => JSON.stringify(tests.map((t) => ({ input: t.input, is_hidden: t.is_hidden, expected_output: t.expected_output })))
const lit = (k, v) => `"${k}": ${JSON.stringify(v)}`   // how tests.json spells a key/value pair

async function snapshot(client) {
  const { rows } = await client.query(
    `SELECT id, slug, title, test_cases AS tests, md5((to_jsonb(p) - 'test_cases')::text) AS other_cols_md5
       FROM coding_problems p WHERE id = $1`, [ID])
  const { rows: others } = await client.query('SELECT id, md5(p::text) AS m FROM coding_problems p WHERE id <> $1 ORDER BY id', [ID])
  return { row: rows[0], others }
}

/** Plans the in-place file edit. Returns { state: 'old'|'new', original, updated }. Throws if the file is not in a known state. */
function planFile() {
  const original = fs.readFileSync(FILE, 'utf8')
  const parsed = JSON.parse(original)
  if (norm(parsed) === norm(AFTER)) return { state: 'new', original, updated: original }
  same(norm(parsed), norm(BEFORE), 'tests.json is not in the audited state (the ten tests differ). Nothing changed.')
  const pairs = [[lit('input', OLD.input), lit('input', NEW.input)], [lit('expected_output', OLD.expected_output), lit('expected_output', NEW.expected_output)]]
  let updated = original
  for (const [from, to] of pairs) {
    assert.strictEqual(original.split(from).length - 1, 1, `Expected exactly one occurrence of ${from} in tests.json. Nothing changed.`)
    updated = updated.replace(from, () => to)
  }
  same(norm(JSON.parse(updated)), norm(AFTER), 'The edited tests.json would not equal the intended tests. Nothing changed.')
  let reversed = updated
  for (const [from, to] of pairs) reversed = reversed.replace(to, () => from)
  same(reversed, original, 'Reversing the edit does not restore the original bytes. Nothing changed.')
  return { state: 'old', original, updated }
}

;(async () => {
  let fileWritten = false, plan = null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM coding_problems WHERE id = $1 FOR UPDATE', [ID])
    const before = await snapshot(client)
    const r = before.row
    assert(r, `Problem ${ID} not found. Nothing changed.`)
    assert(r.slug === SLUG && r.title === TITLE && String(r.id) === String(ID), `Problem ${ID} is ${JSON.stringify(r.title)} / slug ${JSON.stringify(r.slug)}, not "${TITLE}" / ${SLUG}. Nothing changed.`)
    assert(Array.isArray(r.tests) && r.tests.length === 10, `Expected 10 stored tests, found ${Array.isArray(r.tests) ? r.tests.length : 'none'}. Nothing changed.`)
    const dbState = norm(r.tests) === norm(AFTER) ? 'new' : (norm(r.tests) === norm(BEFORE) ? 'old' : null)
    assert(dbState, 'The stored tests are neither the audited ones nor the corrected ones. Nothing changed.')
    plan = planFile()
    console.log(`Database: tests are ${dbState === 'old' ? 'the audited (old) set' : 'already corrected'}.  File: tests.json is ${plan.state === 'old' ? 'the audited (old) set' : 'already corrected'}.`)
    if (dbState === 'new' && plan.state === 'new') { console.log('Both are already corrected. Nothing to do.'); await client.query('ROLLBACK'); return }
    if (dryRun) {
      console.log(`Pre-checks passed. Dry run: would change ${dbState === 'old' ? 1 : 0} database row and ${plan.state === 'old' ? 1 : 0} file. Nothing was written.`)
      await client.query('ROLLBACK'); return
    }

    let rowsChanged = 0, filesChanged = 0
    if (dbState === 'old') {
      const upd = await client.query(
        `UPDATE coding_problems
            SET test_cases = jsonb_set(jsonb_set(test_cases, '{${IDX},input}', to_jsonb($2::text)), '{${IDX},expected_output}', to_jsonb($3::text))
          WHERE id = $1 AND slug = $4 AND title = $5
            AND test_cases->${IDX}->>'input' = $6 AND test_cases->${IDX}->>'expected_output' = $7 AND test_cases->${IDX}->'is_hidden' = 'true'::jsonb`,
        [ID, NEW.input, NEW.expected_output, SLUG, TITLE, OLD.input, OLD.expected_output])
      assert.strictEqual(upd.rowCount, 1, `Expected to update 1 row, updated ${upd.rowCount}. Rolled back.`)
      rowsChanged = upd.rowCount
      const after = await snapshot(client)
      same(norm(after.row.tests), norm(AFTER), 'After the update the tests are not the intended ones. Rolled back.')
      for (let i = 0; i < before.row.tests.length; i++) {
        if (i === IDX) continue
        same(JSON.stringify(after.row.tests[i]), JSON.stringify(before.row.tests[i]), `Test #${i + 1} changed. Rolled back.`)
      }
      same(after.row.other_cols_md5, before.row.other_cols_md5, 'A column other than test_cases changed. Rolled back.')
      assert.deepStrictEqual(after.others, before.others, 'Another problem row changed. Rolled back.')
    }

    if (plan.state === 'old') {
      const tmp = FILE + '.tmp'
      fs.writeFileSync(tmp, plan.updated, 'utf8'); fs.renameSync(tmp, FILE); fileWritten = true
      const back = fs.readFileSync(FILE, 'utf8')
      same(back, plan.updated, 'tests.json read-back differs from what was written. Rolled back.')
      same(norm(JSON.parse(back)), norm(AFTER), 'tests.json read-back is not the intended tests. Rolled back.')
      filesChanged = 1
    }

    await client.query('COMMIT')
    const { rows: fin } = await client.query('SELECT test_cases AS tests FROM coding_problems WHERE id = $1', [ID])
    const finalFile = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    same(norm(fin[0].tests), norm(AFTER), 'Post-commit check failed for the database row.')
    same(norm(finalFile), norm(AFTER), 'Post-commit check failed for tests.json.')
    console.log(`Database rows changed: ${rowsChanged}`)
    console.log(`Local files changed:   ${filesChanged}  (${path.relative(path.join(__dirname, '..'), FILE)})`)
    console.log('Verified: the other nine tests are byte-identical in the database and in the file; no other column of problem 35 and no other problem changed.\n')
    console.log('Final stored tests (database row 35):')
    fin[0].tests.forEach((t, i) => console.log(`  #${i + 1} ${t.is_hidden ? 'HIDDEN ' : 'visible'} input=${JSON.stringify(t.input)} expected_output=${JSON.stringify(t.expected_output)}${i === IDX ? '   <-- corrected' : ''}`))
    console.log('\nFinal test #6 in tests.json: ' + JSON.stringify(finalFile[IDX]))
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    if (fileWritten && plan) { try { fs.writeFileSync(FILE, plan.original, 'utf8'); console.error('tests.json restored to its original content.') } catch (e) { console.error('WARNING: could not restore tests.json: ' + e.message) } }
    console.error('NOT APPLIED: ' + err.message); process.exitCode = 1
  } finally { client.release(); await pool.end() }
})()
