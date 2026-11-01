-- Rollback for 001. WARNING: drops every user's role. Run 002 down first.
BEGIN;
DROP INDEX IF EXISTS idx_users_role;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users DROP COLUMN IF EXISTS role;
DELETE FROM schema_migrations WHERE version = '001_user_roles';
COMMIT;
