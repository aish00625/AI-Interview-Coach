// Applies database/schema.sql + migrations 001..006 to a FRESH temporary database that already contains candidate data,
// checks nothing is lost, that every migration is re-runnable, and that the down scripts restore the original shape.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const base = process.env.AIC_TEST_DB
if (!base) { test('migration round trip', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const host = process.env.AIC_TEST_HOST || '/tmp'; const port = String(process.env.AIC_TEST_PORT || 55432)
  const dbName = `aic_mig_${Date.now()}`
  const dbDir = path.join(__dirname, '../../../database')
  const mig = (n) => path.join(dbDir, 'migrations', n)
  const psqlArgs = (d) => ['-h', host, '-p', port, '-U', 'postgres', '-d', d, '-v', 'ON_ERROR_STOP=1', '-q', '-X']
  const run = (file) => execFileSync('psql', [...psqlArgs(dbName), '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const sql = (q) => execFileSync('psql', [...psqlArgs(dbName), '-t', '-A', '-c', q], { encoding: 'utf8' }).trim()
  // Derived from the files on disk, then checked against the list the server's startup guard requires, so a new
  // migration cannot be added without the guard (and this round trip) knowing about it.
  const UP = fs.readdirSync(path.join(dbDir, 'migrations')).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql')).map((f) => f.replace(/\.sql$/, '')).sort()

  test.before(() => {
    execFileSync('psql', [...psqlArgs(base), '-c', `CREATE DATABASE ${dbName}`])
    run(path.join(dbDir, 'schema.sql'))
    sql(`INSERT INTO users (email, password_hash, name) VALUES ('old@x.com', 'h', 'Old Candidate');
         INSERT INTO profiles (user_id) SELECT id FROM users;
         INSERT INTO interview_sessions (user_id, interview_type, target_role, difficulty) SELECT id, 'technical', 'Dev', 'easy' FROM users;
         INSERT INTO coding_problems (title, description, difficulty) VALUES ('P', 'd', 'easy');
         INSERT INTO coding_submissions (user_id, problem_id, language, source_code) SELECT u.id, p.id, 'python', 'print(1)' FROM users u, coding_problems p`)
  })
  test.after(() => { try { execFileSync('psql', [...psqlArgs(base), '-c', `DROP DATABASE IF EXISTS ${dbName}`]) } catch { /* ignore */ } })

  const counts = () => sql('SELECT (SELECT count(*) FROM users) || \',\' || (SELECT count(*) FROM interview_sessions) || \',\' || (SELECT count(*) FROM coding_submissions)')

  test('every migration on disk is required by the startup guard (no drift)', () => {
    assert.deepEqual(UP, require('../../utils/migrationCheck').REQUIRED_MIGRATIONS)
    for (const m of UP) assert.ok(fs.existsSync(mig(`${m}.down.sql`)), `${m} has a rollback script`)
  })

  test('migrations apply in order on an existing database without losing data; existing users become candidates', () => {
    assert.equal(counts(), '1,1,1')
    for (const m of UP) run(mig(`${m}.sql`))
    assert.equal(counts(), '1,1,1')
    assert.equal(sql("SELECT role FROM users WHERE email = 'old@x.com'"), 'candidate')
    assert.equal(sql('SELECT count(*) FROM interview_sessions WHERE application_id IS NULL'), '1', 'existing sessions are practice (NULL)')
    assert.equal(sql("SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations"), UP.join(','))
    assert.equal(sql("SELECT slug IS NULL AND hints = '[]'::jsonb FROM coding_problems WHERE title = 'P'"), 't', 'existing problems keep working: slug NULL, hints empty')
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'interview_answers' AND column_name = 'evaluation_meta'"), '1')
  })

  test('every migration is idempotent (safe to re-run)', () => {
    for (const m of UP) run(mig(`${m}.sql`))
    assert.equal(counts(), '1,1,1')
  })

  test('down scripts (reverse order) restore the original schema and keep candidate data; then up again works', () => {
    for (const m of [...UP].reverse()) run(mig(`${m}.down.sql`))
    assert.equal(counts(), '1,1,1')
    for (const t of ['organizations', 'job_openings', 'resumes', 'applications', 'job_assessments']) assert.equal(sql(`SELECT to_regclass('public.${t}')`), '', `${t} dropped`)
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'"), '0')
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'interview_sessions' AND column_name = 'application_id'"), '0')
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'coding_problems' AND column_name IN ('slug','hints')"), '0')
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'interview_answers' AND column_name = 'evaluation_meta'"), '0', 'rollback of 008 removes only the new column')
    assert.equal(sql("SELECT count(*) FROM coding_problems WHERE title = 'P'"), '1', 'the problem itself survives the rollback')
    for (const m of UP) run(mig(`${m}.sql`))
    assert.equal(counts(), '1,1,1')
  })
}
