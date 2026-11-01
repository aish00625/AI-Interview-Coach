-- Rollback of 011. DELETES all scorecards and ratings, the blind-review flags and custom criteria, and the stored
-- rejection reason codes (the status history rows themselves are kept).
BEGIN;
DROP TABLE IF EXISTS application_scorecard_ratings;
DROP TABLE IF EXISTS application_scorecards;
ALTER TABLE application_status_history DROP COLUMN IF EXISTS reason_code;
ALTER TABLE job_openings DROP COLUMN IF EXISTS scorecard_criteria;
ALTER TABLE job_openings DROP COLUMN IF EXISTS blind_review;
DELETE FROM schema_migrations WHERE version = '011_review_workflow';
COMMIT;
