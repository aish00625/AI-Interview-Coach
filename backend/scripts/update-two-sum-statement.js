#!/usr/bin/env node
/**
 * One-off, approved update: rewrite the statement of Two Sum (coding_problems.id = 1) so it documents the real judge
 * format. Changes ONLY description, constraints and examples of that one row.
 *   node scripts/update-two-sum-statement.js --dry-run   # run every check, print the plan, change nothing
 *   node scripts/update-two-sum-statement.js             # apply
 * One transaction; everything is rolled back unless ALL checks pass:
 *   BEFORE  id 1, title "Two Sum", slug NULL, description and constraints still the original text, and the four stored
 *           tests exactly the known ones (same inputs, expected outputs 0 1 / 1 2 / 0 1 / 1 2, visibility unchanged).
 *   UPDATE  WHERE id = 1 AND title = 'Two Sum' AND slug IS NULL AND description/constraints = original -> exactly 1 row.
 *   AFTER   test_cases text is byte-identical to before; every other column of row 1 is identical; every OTHER problem
 *           row is identical (checked by md5 of the whole row); description/constraints/examples equal the new text.
 * Touches no other table. Prints no secrets.
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const assert = require('assert')
const { pool } = require('../config/db')

const ID = 1
const OLD_DESCRIPTION = 'Given an integer array nums and an integer target, return the indices of two distinct elements whose sum equals target.'
const OLD_CONSTRAINTS = 'Each input has exactly one solution. You may not use the same element twice.'

const NEW_DESCRIPTION = [
  'Given a list of integers and a target value, find the two different positions i and j (i < j) whose values add up to the target, and print those positions (0-based).',
  '',
  'Input format',
  'Line 1: the elements of the list, separated by single spaces.',
  'Line 2: the target value. The target is always on the final line.',
  'The length of the list is not given: the whole of line 1 is the list, so read every number on line 1.',
  '',
  'Output format',
  'Print the two indices i and j (i < j) on one line, separated by a single space. Do not print brackets or commas. For example, print 0 1, not [0,1] or 0,1.',
  '',
  'Expected solution behaviour',
  'Exactly one pair of positions adds up to the target. The same position cannot be used twice, but two different positions may hold equal values. Scan the list once, remembering each value and its position in a hash map. For each value x, look up target - x. If it is already in the map, you have the pair.',
].join('\n')
const NEW_CONSTRAINTS = '2 <= number of elements <= 100000. Every element and the target fit in a 32-bit signed integer; values may be negative or zero. Exactly one pair of different positions has the target as its sum. Print the smaller index first.'
const NEW_EXAMPLES = [
  { input: '2 7 11 15\n9', output: '0 1', explanation: '2 + 7 = 9, at positions 0 and 1.' },
  { input: '3 2 4\n6', output: '1 2', explanation: '2 + 4 = 6; the 3 at position 0 cannot pair with itself.' },
  { input: '3 3\n6', output: '0 1', explanation: 'Two different positions may hold the same value: 3 + 3 = 6.' },
]
const KNOWN_TESTS = [
  { input: '2 7 11 15\n9', is_hidden: false, expected_output: '0 1' },
  { input: '3 2 4\n6', is_hidden: false, expected_output: '1 2' },
  { input: '3 3\n6', is_hidden: true, expected_output: '0 1' },
  { input: '1 5 8 10\n13', is_hidden: true, expected_output: '1 2' },
]
const dryRun = process.argv.includes('--dry-run')
const norm = (tests) => JSON.stringify(tests.map((t) => ({ input: t.input, is_hidden: t.is_hidden, expected_output: t.expected_output })))

async function snapshot(client) {
  const { rows } = await client.query(
    `SELECT id, title, slug, test_cases::text AS tests_text, test_cases AS tests, description, constraints, examples,
            md5(p::text) AS row_md5, md5((to_jsonb(p) - 'description' - 'constraints' - 'examples')::text) AS other_cols_md5
       FROM coding_problems p WHERE id = $1`, [ID])
  const { rows: others } = await client.query('SELECT id, md5(p::text) AS m FROM coding_problems p WHERE id <> $1 ORDER BY id', [ID])
  return { row: rows[0], others }
}

;(async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM coding_problems WHERE id = $1 FOR UPDATE', [ID])
    const before = await snapshot(client)
    const r = before.row
    assert(r, `Problem ${ID} not found. Nothing changed.`)
    assert(String(r.id) === String(ID), 'Unexpected id. Nothing changed.')
    assert(r.title === 'Two Sum', `Problem ${ID} is titled ${JSON.stringify(r.title)}, not "Two Sum". Nothing changed.`)
    assert(r.slug === null, `Problem ${ID} has slug ${JSON.stringify(r.slug)}; expected NULL. Nothing changed.`)
    if (r.description === NEW_DESCRIPTION && r.constraints === NEW_CONSTRAINTS) {
      console.log('The new statement is already in place. Nothing to do.'); await client.query('ROLLBACK'); return
    }
    assert(r.description === OLD_DESCRIPTION, 'The description is not the original text any more (someone edited it). Nothing changed.')
    assert(r.constraints === OLD_CONSTRAINTS, 'The constraints are not the original text any more. Nothing changed.')
    assert(Array.isArray(r.tests) && r.tests.length === 4, `Expected 4 stored tests, found ${Array.isArray(r.tests) ? r.tests.length : 'none'}. Nothing changed.`)
    assert.strictEqual(norm(r.tests), norm(KNOWN_TESTS), 'The stored tests are not the four known tests. Nothing changed.')
    console.log('Pre-checks passed: id 1, "Two Sum", slug NULL, original description and constraints, 4 known tests.')
    if (dryRun) { console.log('Dry run: would update description, constraints and examples. No change made.'); await client.query('ROLLBACK'); return }

    const upd = await client.query(
      `UPDATE coding_problems SET description = $2, constraints = $3, examples = $4::jsonb
        WHERE id = $1 AND title = 'Two Sum' AND slug IS NULL AND description = $5 AND constraints = $6`,
      [ID, NEW_DESCRIPTION, NEW_CONSTRAINTS, JSON.stringify(NEW_EXAMPLES), OLD_DESCRIPTION, OLD_CONSTRAINTS])
    assert.strictEqual(upd.rowCount, 1, `Expected to update 1 row, updated ${upd.rowCount}. Rolled back.`)

    const after = await snapshot(client)
    const a = after.row
    assert.strictEqual(a.tests_text, r.tests_text, 'test_cases changed. Rolled back.')
    assert.strictEqual(a.other_cols_md5, r.other_cols_md5, 'A column other than description/constraints/examples changed. Rolled back.')
    assert.strictEqual(a.description, NEW_DESCRIPTION, 'description does not match the approved text. Rolled back.')
    assert.strictEqual(a.constraints, NEW_CONSTRAINTS, 'constraints do not match the approved text. Rolled back.')
    assert.deepStrictEqual(a.examples, NEW_EXAMPLES, 'examples do not match the approved examples. Rolled back.')
    assert.deepStrictEqual(after.others, before.others, 'Another problem row changed. Rolled back.')

    await client.query('COMMIT')
    console.log(`Rows updated: ${upd.rowCount}`)
    console.log(`Verified: the 4 test cases are byte-identical; no other column of problem 1 and none of the other ${after.others.length} problems changed.\n`)
    console.log(`=== FINAL STATEMENT: problem ${a.id} "${a.title}" ===\n`)
    console.log(a.description + '\n')
    console.log('Constraints:\n' + a.constraints + '\n')
    console.log('Examples:')
    a.examples.forEach((e, i) => console.log(`  ${i + 1}. input ${JSON.stringify(e.input)} -> output ${JSON.stringify(e.output)}  (${e.explanation})`))
    console.log('\nStored tests (unchanged):')
    a.tests.forEach((t, i) => console.log(`  #${i + 1} ${t.is_hidden ? 'HIDDEN ' : 'visible'} input=${JSON.stringify(t.input)} expected_output=${JSON.stringify(t.expected_output)}`))
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    console.error('NOT APPLIED: ' + err.message); process.exitCode = 1
  } finally { client.release(); await pool.end() }
})()
