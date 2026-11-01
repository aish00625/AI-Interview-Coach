-- Rollback of 018_hirer_assessments.sql. Removes ONLY the objects 018 created (and the assessment data stored in them).
-- Practice face-monitoring sessions are untouched; the link column is dropped. Run only on purpose, never automatically.
BEGIN;
DROP INDEX IF EXISTS idx_face_monitoring_sessions_attempt;
ALTER TABLE face_monitoring_sessions DROP COLUMN IF EXISTS assessment_attempt_id;
DROP TABLE IF EXISTS assessment_review_notes;
DROP TABLE IF EXISTS assessment_coding_submissions;
DROP TABLE IF EXISTS assessment_answers;
DROP TABLE IF EXISTS assessment_attempts;
DROP TABLE IF EXISTS assessment_invitations;
DROP TABLE IF EXISTS assessment_reviewers;
DROP TABLE IF EXISTS assessment_items;
DROP TABLE IF EXISTS assessment_sections;
DROP TABLE IF EXISTS assessments;
DROP TABLE IF EXISTS mcq_questions;
DELETE FROM schema_migrations WHERE version = '018_hirer_assessments';
COMMIT;
