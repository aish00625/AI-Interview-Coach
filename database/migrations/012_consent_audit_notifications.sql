-- 012_consent_audit_notifications.sql (Phase J, additive). Requires 005.
--  * applications.consent_*   explicit candidate consent to share (a) resume + profile and (b) job-assessment results
--                             with the hiring organization. NULL = not given. Applications created before this
--                             migration are NOT back-filled: consent is never assumed; the candidate is asked.
--  * access_audit_log         who in a hiring team opened a candidate's resume or assessment data, and when
--  * notifications            in-app messages (application status changes)
-- Rollback: 012_consent_audit_notifications.down.sql
BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_resume_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_assessment_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_version VARCHAR(20);

CREATE TABLE IF NOT EXISTS access_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  application_id   BIGINT REFERENCES applications(id) ON DELETE SET NULL,
  action           VARCHAR(40) NOT NULL CHECK (action IN ('resume_view', 'resume_download', 'assessment_view', 'comparison_view')),
  detail           JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON access_audit_log(organization_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_application ON access_audit_log(application_id, id DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(40) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  body            TEXT,
  application_id  BIGINT REFERENCES applications(id) ON DELETE SET NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('012_consent_audit_notifications') ON CONFLICT DO NOTHING;
COMMIT;
