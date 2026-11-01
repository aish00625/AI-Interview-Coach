#!/usr/bin/env node
/**
 * One-off, approved correction: Two Sum (coding_problems.id = 1), stored test #4 (array index 3).
 * Input "1 5 8 10 / 13" has its only pair at positions 1 and 2 (5 + 8), so expected_output must be "1 2", not "2 3".
 *   node scripts/fix-two-sum-test4.js --dry-run   # verify and show the plan; changes nothing
 *   node scripts/fix-two-sum-test4.js             # apply
 * Everything runs in ONE transaction and is rolled back unless every check passes:
 *   - problem 1 is titled "Two Sum" and test #4 still has the expected input and expected_output "2 3"
 *   - exactly 1 row is updated (the WHERE clause also re-checks the old value)
 *   - afterwards ONLY test #4's expected_output differs; every other test and field is byte-identical
 * Touches no other problem, submission or table. Prints no secrets.
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const assert = require('assert')
const { pool } = require('../config/db')

const PROBLEM_ID = 1, INDEX = 3, OLD = '2 3', NEW = '1 2', INPUT = '1 5 8 10\n13'
const dryRun = process.argv.includes('--dry-run')

;(async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT title, test_cases FROM coding_problems WHERE id = $1 FOR UPDATE', [PROBLEM_ID])
    assert(rows.length === 1, `Problem ${PROBLEM_ID} not found.`)
    const before = rows[0].test_cases
    assert(rows[0].title === 'Two Sum', `Problem ${PROBLEM_ID} is "${rows[0].title}", not "Two Sum". Nothing changed.`)
    assert(Array.isArray(before) && before.length === 4, `Expected 4 stored tests, found ${Array.isArray(before) ? before.length : 'none'}. Nothing changed.`)
    const t = before[INDEX]
    assert(String(t.input).trim() === INPUT, `Test #4 input is ${JSON.stringify(t.input)}, not the expected one. Nothing changed.`)
    if (t.expected_output === NEW) { console.log('Test #4 already has expected_output "1 2". Nothing to do.'); await client.query('ROLLBACK'); return }
    assert(t.expected_output === OLD, `Test #4 expected_output is ${JSON.stringify(t.expected_output)}, not "2 3". Nothing changed.`)
    console.log(`Current value verified: test #4 expected_output = ${JSON.stringify(t.expected_output)}`)
    if (dryRun) { console.log('Dry run: would set it to "1 2". No change made.'); await client.query('ROLLBACK'); return }

    const upd = await client.query(
      `UPDATE coding_problems SET test_cases = jsonb_set(test_cases, '{${INDEX},expected_output}', to_jsonb($2::text))
        WHERE id = $1 AND test_cases->${INDEX}->>'expected_output' = $3`, [PROBLEM_ID, NEW, OLD])
    assert.strictEqual(upd.rowCount, 1, `Expected to update 1 row, updated ${upd.rowCount}. Rolled back.`)

    const { rows: after } = await client.query('SELECT test_cases FROM coding_problems WHERE id = $1', [PROBLEM_ID])
    const now = after[0].test_cases
    const expected = JSON.parse(JSON.stringify(before)); expected[INDEX].expected_output = NEW
    assert.deepStrictEqual(now, expected, 'After the update something other than test #4 expected_output differs. Rolled back.')

    await client.query('COMMIT')
    console.log(`Rows updated: ${upd.rowCount}`)
    now.forEach((x, i) => console.log(`#${i + 1} ${x.is_hidden ? 'HIDDEN ' : 'visible'} input=${JSON.stringify(x.input)} expected_output=${JSON.stringify(x.expected_output)}${i === INDEX ? '   <-- changed from "2 3"' : ''}`))
    console.log('Verified: only test #4 changed.')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    console.error('NOT APPLIED: ' + err.message); process.exitCode = 1
  } finally { client.release(); await pool.end() }
})()
