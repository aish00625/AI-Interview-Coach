-- Rollback of 013. Drops typing_metrics (typing telemetry is lost; answers and scores are kept).
BEGIN;
ALTER TABLE interview_answers DROP COLUMN IF EXISTS typing_metrics;
DELETE FROM schema_migrations WHERE version = '013_typing_metrics';
COMMIT;
