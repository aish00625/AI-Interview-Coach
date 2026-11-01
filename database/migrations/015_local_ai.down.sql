-- Rollback of 015_local_ai.sql. Removes only the follow-up turns and saved AI feedback text; no interview, answer, score,
-- coding or account data is touched.
BEGIN;
DROP TABLE IF EXISTS ai_feedback;
DROP TABLE IF EXISTS interview_followups;
DELETE FROM schema_migrations WHERE version = '015_local_ai';
COMMIT;
