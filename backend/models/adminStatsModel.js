const { pool } = require('../config/db')
const { weeklyCountsSql } = require('../utils/weeklySeries')

/**
 * Platform-wide COUNTS for the administrator overview. Aggregates only: no names, emails, password hashes, tokens,
 * resumes, answers, source code or any per-person record is selected here.
 */
const toMap = (rows, key = 'status') => Object.fromEntries(rows.map((r) => [r[key], r.n]))
const series = async (opts) => (await pool.query(weeklyCountsSql(opts))).rows

async function getOverview() {
  const [users, orgs, jobs, apps, practice, audit, signups, appsWeekly, pendingOldest] = await Promise.all([
    pool.query('SELECT role, count(*)::int AS n FROM users GROUP BY role'),
    pool.query('SELECT status, count(*)::int AS n FROM organizations GROUP BY status'),
    pool.query('SELECT status, count(*)::int AS n FROM job_openings GROUP BY status'),
    pool.query('SELECT status, count(*)::int AS n FROM applications GROUP BY status'),
    pool.query(
      `SELECT
         (SELECT count(*) FROM interview_sessions WHERE application_id IS NULL AND started_at >= now() - interval '30 days')::int AS sessions_started,
         (SELECT count(*) FROM interview_sessions WHERE application_id IS NULL AND status = 'completed' AND completed_at >= now() - interval '30 days')::int AS sessions_completed,
         (SELECT count(*) FROM coding_submissions WHERE application_id IS NULL AND submitted_at >= now() - interval '30 days')::int AS submissions,
         (SELECT count(*) FROM coding_submissions WHERE application_id IS NULL AND status = 'passed' AND submitted_at >= now() - interval '30 days')::int AS submissions_passed,
         (SELECT count(DISTINCT user_id) FROM (
            SELECT user_id FROM interview_sessions WHERE application_id IS NULL AND started_at >= now() - interval '30 days'
            UNION ALL SELECT user_id FROM coding_submissions WHERE application_id IS NULL AND submitted_at >= now() - interval '30 days') x)::int AS active_candidates`),
    pool.query(`SELECT action, count(*)::int AS n FROM access_audit_log WHERE created_at >= now() - interval '30 days' GROUP BY action ORDER BY action`),
    series({ fromSql: 'users', tsColumn: 'created_at' }),
    series({ fromSql: 'applications', tsColumn: 'created_at' }),
    pool.query(`SELECT min(created_at) AS oldest FROM organizations WHERE status = 'pending'`),
  ])
  const p = practice.rows[0]
  return {
    usersByRole: toMap(users.rows, 'role'),
    organizationsByStatus: toMap(orgs.rows),
    jobsByStatus: toMap(jobs.rows),
    applicationsByStatus: toMap(apps.rows),
    practiceLast30Days: {
      interviewsStarted: p.sessions_started, interviewsCompleted: p.sessions_completed,
      codeSubmissions: p.submissions, codeSubmissionsPassed: p.submissions_passed, activeCandidates: p.active_candidates,
    },
    dataAccessLast30Days: audit.rows.map((r) => ({ action: r.action, count: r.n })),
    signupsByWeek: signups,
    applicationsByWeek: appsWeekly,
    oldestPendingOrganizationAt: pendingOldest.rows[0].oldest,
  }
}

async function getDatabaseStatus() {
  const { rows } = await pool.query('SELECT max(version) AS latest, count(*)::int AS applied FROM schema_migrations')
  return { latestMigration: rows[0].latest, migrationsApplied: rows[0].applied }
}

module.exports = { getOverview, getDatabaseStatus }
