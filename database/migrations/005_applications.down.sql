-- Rollback for 005. WARNING: deletes all applications, their history and hirer notes. Run 006 down first if applied.
BEGIN;
DROP TABLE IF EXISTS application_notes;
DROP TABLE IF EXISTS application_status_history;
DROP TABLE IF EXISTS applications;
DELETE FROM schema_migrations WHERE version = '005_applications';
COMMIT;
