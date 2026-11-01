/**
 * Startup guard: the code in this version reads/writes columns and tables created by migrations 001-015. Starting
 * against an older database would fail later with confusing "column does not exist" errors on ordinary candidate pages,
 * so fail fast with an actionable message instead.
 */
const REQUIRED_MIGRATIONS = [
  '001_user_roles', '002_organizations', '003_jobs', '004_resumes', '005_applications', '006_job_assessments', '007_coding_problem_content', '008_answer_evaluation_meta', '009_coding_hint_reveals',
  '010_hiring_team', '011_review_workflow', '012_consent_audit_notifications', '013_typing_metrics', '014_user_goals', '015_local_ai', '016_score_breakdown', '017_face_monitoring', '018_hirer_assessments',
]

async function findMissingMigrations(pool) {
  let applied
  try {
    const { rows } = await pool.query('SELECT version FROM schema_migrations')
    applied = new Set(rows.map((r) => r.version))
  } catch (err) {
    if (err.code === '42P01') return [...REQUIRED_MIGRATIONS] // schema_migrations itself does not exist yet
    throw err
  }
  return REQUIRED_MIGRATIONS.filter((v) => !applied.has(v))
}

module.exports = { findMissingMigrations, REQUIRED_MIGRATIONS }
