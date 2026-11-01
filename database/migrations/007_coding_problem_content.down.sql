-- Rollback of 007. Removes the slug and hints columns (hint text is lost; problems, tests and submissions are kept).
-- Re-seeding after a re-apply restores seeded hints.
BEGIN;
DROP INDEX IF EXISTS uq_coding_problems_slug;
ALTER TABLE coding_problems DROP COLUMN IF EXISTS hints;
ALTER TABLE coding_problems DROP COLUMN IF EXISTS slug;
DELETE FROM schema_migrations WHERE version = '007_coding_problem_content';
COMMIT;
