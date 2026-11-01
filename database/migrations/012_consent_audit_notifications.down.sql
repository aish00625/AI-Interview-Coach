-- Rollback of 012. DELETES the audit log, all notifications, and recorded consents (hirers would then see
-- applications as "consent not recorded"). Applications themselves are kept.
BEGIN;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS access_audit_log;
ALTER TABLE applications DROP COLUMN IF EXISTS consent_version;
ALTER TABLE applications DROP COLUMN IF EXISTS consent_assessment_at;
ALTER TABLE applications DROP COLUMN IF EXISTS consent_resume_at;
DELETE FROM schema_migrations WHERE version = '012_consent_audit_notifications';
COMMIT;
