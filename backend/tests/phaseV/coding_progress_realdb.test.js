// Coding progress end to end: REAL route chains + REAL PostgreSQL (see tests/helpers/miniApp.js for what is stubbed).
// Bug under test: the Coding Problems page showed every problem as "Not started" and "0 solved" after passing submissions,
// because GET /coding/problems returns ids as STRINGS (BIGINT through the real `pg` driver) while GET /coding/progress returns
// numbers, and the page matched them with a Map. The shim normally returns numeric ids and hid this, so this file turns on
// AIC_TEST_BIGINT_STRINGS (real-driver behaviour) and runs the page's own matching code (frontend/src/utils/codingProgress.js).
// The code executor is replaced by a LOCAL stand-in that really runs the submitted Python against the problem's stored tests
// with the same judge rule as the Docker executor (stdout.strip() == expected.strip()); it is not Docker.
// AIC_TEST_USE_SEEDED=1 uses the already-seeded "Two Sum" and "Rotate Array" rows instead of creating fixture problems.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process')

if (!process.env.AIC_TEST_DB) { test('Coding progress DB', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  process.env.AIC_TEST_BIGINT_STRINGS = '1'
  const { setup } = require('../phaseJ/harness')
  const { root } = require('../phaseA/helpers')
  const H = setup('v')
  const { api, ok, pool, register, tag } = H
  const seeded = process.env.AIC_TEST_USE_SEEDED === '1'
  const created = { problems: [], users: [] }

  const TWO_SUM = [['2 7 11 15\n9', '0 1', false], ['3 2 4\n6', '1 2', false], ['3 3\n6', '0 1', true], ['1 5 8 10\n13', '1 2', true]]
  const ROTATE = [['5 2\n1 2 3 4 5\n', '4 5 1 2 3', false], ['3 4\n1 2 3\n', '3 1 2', false], ['1 5\n7\n', '7', false], ['4 0\n1 2 3 4\n', '1 2 3 4', true], ['4 4\n1 2 3 4\n', '1 2 3 4', true],
    ['6 1000000001\n1 2 3 4 5 6\n', '2 3 4 5 6 1', true], ['2 1\n-5 9\n', '9 -5', true], ['7 3\n10 20 30 40 50 60 70\n', '50 60 70 10 20 30 40', true], ['5 10\n0 0 1 0 0\n', '0 0 1 0 0', true], ['8 13\n-70 -19 28 31 65 -74 -43 53\n', '31 65 -74 -43 53 -70 -19 28', true]]
  const SOLVE_TWO_SUM = "import sys\nL=sys.stdin.read().split('\\n'); a=list(map(int,L[0].split())); t=int(L[1]); d={}\nfor i,x in enumerate(a):\n    if t-x in d: print(d[t-x],i); break\n    d[x]=i\n"
  const SOLVE_ROTATE = "import sys\nL=sys.stdin.read().split('\\n'); n,k=map(int,L[0].split()); a=L[1].split(); k%=n\nprint(' '.join(a[n-k:]+a[:n-k]))\n"
  const WRONG = "import sys\nprint(sys.stdin.read().split('\\n')[0])\n"   // echoes the first input line: wrong for both problems

  // Local stand-in for the Docker executor: really runs the code, same pass rule, same result shape.
  const exec = require(path.join(root, 'services/codeExecutorClient'))
  exec.executeCode = async ({ language, sourceCode, testCases }) => {
    assert.equal(language, 'python')
    const file = path.join(os.tmpdir(), `sub-${tag}-${Math.random().toString(36).slice(2)}.py`); fs.writeFileSync(file, sourceCode)
    try {
      const tests = testCases.map((tc, i) => {
        const r = spawnSync('python3', [file], { input: tc.input, encoding: 'utf8', timeout: 10000 })
        return { index: i + 1, passed: r.status === 0 && String(r.stdout).trim() === String(tc.expectedOutput).trim() }
      })
      return { status: 'completed', passedTests: tests.filter((t) => t.passed).length, totalTests: tests.length, tests, stderr: '', executionTimeMs: 5, memoryUsedKb: null }
    } finally { fs.rmSync(file, { force: true }) }
  }

  async function makeProblem(title, tests) {
    const { rows } = await pool.query(
      `INSERT INTO coding_problems (topic_id, title, description, difficulty, test_cases) VALUES ((SELECT id FROM topics WHERE name = 'Arrays'), $1, 'desc', 'easy', $2) RETURNING id`,
      [`${title} ${tag}`, JSON.stringify(tests.map(([input, expected_output, is_hidden]) => ({ input, expected_output, is_hidden })))])
    created.problems.push(rows[0].id); return String(rows[0].id)
  }
  const idByTitle = async (t) => String((await pool.query('SELECT id FROM coding_problems WHERE title = $1 ORDER BY id LIMIT 1', [t])).rows[0].id)

  test('submit -> progress: solved per distinct problem, per user, with real-driver id types', async (t) => {
    t.after(async () => { // runs before the harness closes the connections
      if (created.users.length) await pool.query('DELETE FROM coding_submissions WHERE user_id = ANY($1::bigint[])', [created.users])
      if (created.problems.length) await pool.query('DELETE FROM coding_problems WHERE id = ANY($1::bigint[])', [created.problems])
    })
    const { buildProgressMap, countSolved, progressFor, statusFor } = await import('../../../frontend/src/utils/codingProgress.js')
    const twoSum = seeded ? await idByTitle('Two Sum') : await makeProblem('Two Sum', TWO_SUM)
    const rotate = seeded ? await idByTitle('Rotate Array') : await makeProblem('Rotate Array', ROTATE)
    t.diagnostic(`problems used: Two Sum id=${twoSum}, Rotate Array id=${rotate} (${seeded ? 'seeded rows' : 'fixture rows'})`)
    const other = await makeProblem('Never solved', TWO_SUM)
    const hiddenBefore = JSON.stringify((await pool.query('SELECT id, test_cases, title, description FROM coding_problems WHERE id = ANY($1::bigint[]) ORDER BY id', [[twoSum, rotate]])).rows)

    const A = await register('pa'); const B = await register('pb'); created.users.push(A.user.id, B.user.id)
    const submit = (who, problemId, sourceCode) => api('POST', '/api/coding/submissions', { token: who.token, body: { problemId: Number(problemId), language: 'python', sourceCode } })
    const page = async (who) => { // exactly what the Coding Problems page does on (re)load
      const problems = ok(await api('GET', '/api/coding/problems'))
      const rows = ok(await api('GET', '/api/coding/progress', { token: who.token })).progress
      const map = buildProgressMap(rows)
      return { problems, rows, map, solved: countSolved(problems, map), status: (id) => statusFor(map, id) }
    }

    // 0. the types that caused the bug, as the real driver delivers them
    let a = await page(A)
    assert.equal(typeof a.problems.find((p) => String(p.id) === twoSum).id, 'string', 'problem ids are strings')
    assert.equal(a.solved, 0); assert.equal(a.status(twoSum), 'new')

    // 1. Two Sum passes 4/4 -> passed row for A -> Solved, count +1
    const r1 = ok(await submit(A, twoSum, SOLVE_TWO_SUM), 201)
    assert.equal(r1.status, 'passed'); assert.equal(r1.test_cases_passed, 4); assert.equal(r1.test_cases_total, 4)
    const row1 = (await pool.query('SELECT user_id, problem_id, status, application_id FROM coding_submissions WHERE id = $1', [r1.id])).rows[0]
    assert.deepEqual([String(row1.user_id), String(row1.problem_id), row1.status, row1.application_id], [String(A.user.id), twoSum, 'passed', null])
    a = await page(A)
    assert.equal(a.rows.find((r) => String(r.problemId) === twoSum).status, 'solved')
    assert.equal(typeof a.rows[0].problemId, 'number', 'progress ids are numbers')
    assert.equal(new Map(a.rows.map((r) => [r.problemId, r])).get(a.problems.find((p) => String(p.id) === twoSum).id), undefined, 'the old Map lookup misses (the bug)')
    assert.equal(a.status(twoSum), 'solved'); assert.equal(a.solved, 1)

    // 2. Rotate Array passes 10/10 -> count +1 more
    const r2 = ok(await submit(A, rotate, SOLVE_ROTATE), 201)
    assert.equal(r2.status, 'passed'); assert.equal(r2.test_cases_passed, 10); assert.equal(r2.test_cases_total, 10)
    a = await page(A); assert.equal(a.status(rotate), 'solved'); assert.equal(a.solved, 2)

    // 3. wrong answer on an unsolved problem: stored as failed, shown as attempted, never solved
    const r3 = ok(await submit(A, other, WRONG), 201)
    assert.equal(r3.status, 'failed')
    a = await page(A); assert.equal(a.status(other), 'attempted'); assert.equal(a.solved, 2)
    // ...and a wrong answer on an already-solved problem does not un-solve it
    assert.equal(ok(await submit(A, twoSum, WRONG), 201).status, 'failed')
    a = await page(A); assert.equal(a.status(twoSum), 'solved'); assert.equal(a.solved, 2)

    // pending / error rows never count as solved
    for (const st of ['pending', 'error']) await pool.query(`INSERT INTO coding_submissions (user_id, problem_id, language, source_code, status) VALUES ($1,$2,'python','x',$3)`, [A.user.id, other, st])
    a = await page(A); assert.equal(a.status(other), 'attempted'); assert.equal(a.solved, 2)

    // 4. another correct submission for an already solved problem: still 2 solved, still one progress row per problem
    assert.equal(ok(await submit(A, twoSum, SOLVE_TWO_SUM), 201).status, 'passed')
    a = await page(A); assert.equal(a.solved, 2)
    assert.equal(a.rows.filter((r) => String(r.problemId) === twoSum).length, 1)
    assert.ok(progressFor(a.map, twoSum).attempts >= 3, 'attempts are counted, solved is not')

    // 5. leaving and returning / refreshing = the page's two fetches again: same answer. Logout/login: same account, same progress.
    const again = await page(A); assert.equal(again.solved, 2)
    const login = ok(await api('POST', '/api/auth/login', { body: { email: H.email('pa'), password: 'password123' } }))
    assert.equal((await page({ token: login.token })).solved, 2)

    // 6. isolation: B sees none of A's progress, A's list never contains B's, and B solving Two Sum changes only B
    let b = await page(B); assert.equal(b.solved, 0); assert.equal(b.rows.length, 0)
    assert.equal(ok(await submit(B, twoSum, SOLVE_TWO_SUM), 201).status, 'passed')
    b = await page(B); assert.equal(b.solved, 1); assert.equal(b.status(rotate), 'new')
    a = await page(A); assert.equal(a.solved, 2)
    const aSubs = ok(await api('GET', '/api/coding/submissions', { token: A.token }))
    assert.ok(aSubs.length >= 5 && aSubs.every((s) => String(s.user_id) === String(A.user.id)))
    assert.equal((await api('GET', '/api/coding/progress')).status, 401, 'progress needs a login')

    // no hidden test data in either response the page uses
    const wire = JSON.stringify([ok(await api('GET', '/api/coding/problems')), ok(await api('GET', '/api/coding/progress', { token: A.token }))])
    assert.ok(!/expected_output|test_cases|SECRET|is_hidden/.test(wire.replace(/"test_cases_(passed|total)"/g, '')))

    // the problems themselves were not touched
    assert.equal(JSON.stringify((await pool.query('SELECT id, test_cases, title, description FROM coding_problems WHERE id = ANY($1::bigint[]) ORDER BY id', [[twoSum, rotate]])).rows), hiddenBefore)
  })

}
