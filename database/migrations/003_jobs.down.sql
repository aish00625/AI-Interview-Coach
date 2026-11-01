-- Rollback for 003. WARNING: deletes all job openings. Run 005/006/004 down scripts first if applied.
BEGIN;
DROP TABLE IF EXISTS job_required_skills;
DROP TABLE IF EXISTS job_openings;
DELETE FROM schema_migrations WHERE version = '003_jobs';
COMMIT;
