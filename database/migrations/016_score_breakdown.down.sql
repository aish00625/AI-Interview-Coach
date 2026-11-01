-- Rollback of 016_score_breakdown.sql. Drops only the stored breakdown JSON. final_score values already written stay as they are.
BEGIN;
ALTER TABLE interview_sessions DROP COLUMN IF EXISTS score_breakdown;
DELETE FROM schema_migrations WHERE version = '016_score_breakdown';
COMMIT;
