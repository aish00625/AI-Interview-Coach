// Migrations 010-012 on a fresh database that already has Phase A-I data: additive, re-runnable, and reversible.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path')
const { execFileSync } = require('child_process')

const base = process.env.AIC_TEST_DB
if (!base) { test('Phase J migrations', { skip: 'AIC_TEST_DB not set' }, () => {}) } else {
  const host = process.env.AIC_TEST_HOST || '/tmp'; const port = String(process.env.AIC_TEST_PORT || 55432)
  const dbName = `aic_migj_${Date.now()}`
  const dbDir = path.join(__dirname, '../../../database')
  const mig = (n) => path.join(dbDir, 'migrations', n)
  const args = (d) => ['-h', host, '-p', port, '-U', 'postgres', '-d', d, '-v', 'ON_ERROR_STOP=1', '-q', '-X']
  const run = (f) => execFileSync('psql', [...args(dbName), '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const sql = (q) => execFileSync('psql', [...args(dbName), '-t', '-A', '-c', q], { encoding: 'utf8' }).trim()
  const ALL = fs.readdirSync(path.join(dbDir, 'migrations')).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql')).map((f) => f.replace(/\.sql$/, '')).sort()
  const J = ALL.filter((m) => /^01[012]_/.test(m))

  test.before(() => {
    execFileSync('psql', [...args(base), '-c', `CREATE DATABASE ${dbName}`])
    run(path.join(dbDir, 'schema.sql'))
    for (const m of ALL.filter((x) => !J.includes(x))) run(mig(`${m}.sql`))
    sql(`INSERT INTO users (email, password_hash, name, role) VALUES ('o@x.com','h','Owner','hirer'),('r@x.com','h','Rev','hirer'),('c@x.com','h','Cand','candidate');
         INSERT INTO organizations (name, status, created_by) SELECT 'Org','approved',id FROM users WHERE email='o@x.com';
         INSERT INTO organization_members (organization_id, user_id, member_role) SELECT o.id, u.id, 'owner' FROM organizations o, users u WHERE u.email='o@x.com';
         INSERT INTO job_openings (organization_id, created_by, title, description) SELECT o.id, o.created_by, 'J', 'd' FROM organizations o;
         INSERT INTO resumes (user_id, original_filename, content_type, size_bytes, storage_key) SELECT id,'a.pdf','application/pdf',1,'k1' FROM users WHERE email='c@x.com';
         INSERT INTO applications (job_id, candidate_id, resume_id) SELECT j.id, u.id, r.id FROM job_openings j, users u, resumes r WHERE u.email='c@x.com' AND r.user_id=u.id`)
  })
  test.after(() => { try { execFileSync('psql', [...args(base), '-c', `DROP DATABASE IF EXISTS ${dbName}`]) } catch { /* ignore */ } })

  test('010-012 apply to existing data without touching it; existing applications have NO consent assumed', () => {
    assert.deepEqual(J, ['010_hiring_team', '011_review_workflow', '012_consent_audit_notifications'])
    for (const m of J) run(mig(`${m}.sql`))
    assert.equal(sql('SELECT count(*) FROM applications'), '1'); assert.equal(sql('SELECT count(*) FROM organization_members'), '1')
    assert.equal(sql('SELECT consent_resume_at IS NULL AND consent_assessment_at IS NULL FROM applications'), 't', 'consent is never back-filled')
    assert.equal(sql('SELECT blind_review FROM job_openings'), 'f')
  })

  test('each migration is re-runnable', () => { for (const m of J) run(mig(`${m}.sql`)); assert.equal(sql('SELECT count(*) FROM applications'), '1') })

  test('the reviewer role is accepted, and invalid roles are still rejected by the database', () => {
    sql(`INSERT INTO organization_members (organization_id, user_id, member_role) SELECT o.id, u.id, 'reviewer' FROM organizations o, users u WHERE u.email='r@x.com'`)
    assert.throws(() => sql(`UPDATE organization_members SET member_role = 'admin' WHERE member_role = 'reviewer'`), /check constraint/)
    assert.throws(() => sql(`INSERT INTO application_scorecards (application_id, recommendation) SELECT id, 'maybe' FROM applications`), /check constraint/)
    assert.throws(() => sql(`INSERT INTO access_audit_log (action) VALUES ('anything')`), /check constraint/)
  })

  test('rollback in reverse order removes only Phase J structures; reviewers are removed (not promoted); earlier data survives', () => {
    sql(`INSERT INTO notifications (user_id, type, title) SELECT id, 't', 'x' FROM users WHERE email='c@x.com'`)
    for (const m of [...J].reverse()) run(mig(`${m}.down.sql`))
    assert.equal(sql("SELECT count(*) FROM organization_members WHERE member_role = 'reviewer'"), '0')
    assert.equal(sql("SELECT count(*) FROM organization_members WHERE member_role = 'owner'"), '1')
    assert.equal(sql("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('organization_invitations','application_scorecards','application_scorecard_ratings','access_audit_log','notifications')"), '0')
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE (table_name='applications' AND column_name LIKE 'consent%') OR (table_name='job_openings' AND column_name IN ('blind_review','scorecard_criteria')) OR (table_name='application_status_history' AND column_name='reason_code')"), '0')
    assert.equal(sql('SELECT count(*) FROM applications'), '1'); assert.equal(sql('SELECT count(*) FROM job_openings'), '1')
    assert.equal(sql("SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations"), ALL.filter((m) => !J.includes(m)).join(','))
    assert.throws(() => sql(`UPDATE organization_members SET member_role = 'reviewer'`), /check constraint/, 'the old two-role constraint is back')
  })

  test('and they apply again after a rollback', () => {
    for (const m of J) run(mig(`${m}.sql`))
    assert.equal(sql("SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations"), ALL.join(','))
  })
}
