-- 002_organizations.sql  (Phase A, additive)
-- Hiring organizations and their members. A new organization starts 'pending'
-- and must be approved by an admin before its hirers can see any candidate data.
-- Requires 001. Safe to run more than once. Rollback: 002_organizations.down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  created_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One organization per hirer for now (UNIQUE user_id); team invites come later.
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  member_role      VARCHAR(20) NOT NULL DEFAULT 'owner'
                     CHECK (member_role IN ('owner', 'recruiter')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

INSERT INTO schema_migrations (version) VALUES ('002_organizations') ON CONFLICT DO NOTHING;
COMMIT;
