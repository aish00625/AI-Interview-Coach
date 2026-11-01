-- Rollback for 004. Run 005 down first if applied. NOTE: uploaded files on disk (RESUME_STORAGE_DIR) are NOT deleted by SQL;
-- remove that folder yourself if you want them gone.
BEGIN;
DROP TABLE IF EXISTS resumes;
DELETE FROM schema_migrations WHERE version = '004_resumes';
COMMIT;
