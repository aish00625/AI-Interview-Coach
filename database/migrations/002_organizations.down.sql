-- Rollback for 002. WARNING: deletes all organizations and memberships.
BEGIN;
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS organizations;
DELETE FROM schema_migrations WHERE version = '002_organizations';
COMMIT;
