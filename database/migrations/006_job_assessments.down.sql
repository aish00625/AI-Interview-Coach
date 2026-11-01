-- Rollback for 006. Non-destructive for candidate data: sessions/submissions that were hiring assessments are KEPT, but
-- once application_id is dropped they become ordinary entries in that candidate's own practice history/analytics.
-- Only the per-job assessment configuration (job_assessments, job_assessment_problems) is deleted.
BEGIN;
DROP INDEX IF EXISTS uq_interview_sessions_application;
DROP INDEX IF EXISTS idx_coding_submissions_application;
ALTER TABLE interview_sessions DROP COLUMN IF EXISTS application_id;
ALTER TABLE coding_submissions DROP COLUMN IF EXISTS application_id;
DROP TABLE IF EXISTS job_assessment_problems;
DROP TABLE IF EXISTS job_assessments;
DELETE FROM schema_migrations WHERE version = '006_job_assessments';
COMMIT;
