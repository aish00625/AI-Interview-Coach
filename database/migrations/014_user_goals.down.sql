-- Rollback of 014_user_goals.sql. Removes the weekly-goal settings only; no interview, coding or account data is touched.
BEGIN;
DROP TABLE IF EXISTS user_goals;
DELETE FROM schema_migrations WHERE version = '014_user_goals';
COMMIT;
