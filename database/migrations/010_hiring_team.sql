-- 010_hiring_team.sql (Phase J, additive). Requires 002.
-- Hiring-team invitations and a third, read/score-only member role.
--   owner     everything, including managing the team and viewing the access audit log
--   recruiter jobs, decisions, notes, scorecards
--   reviewer  view applications, add notes and scorecards; cannot change statuses or jobs
-- Invitations are single-use and expire; only a SHA-256 hash of the token is stored.
-- Rollback: 010_hiring_team.down.sql (removes reviewer memberships; see the comment there)
BEGIN;

DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'organization_members'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%member_role%'
  LOOP
    EXECUTE format('ALTER TABLE organization_members DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_member_role_check CHECK (member_role IN ('owner', 'recruiter', 'reviewer'));

CREATE TABLE IF NOT EXISTS organization_invitations (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email            VARCHAR(255) NOT NULL,
  member_role      VARCHAR(20) NOT NULL CHECK (member_role IN ('recruiter', 'reviewer')),
  token_hash       CHAR(64) NOT NULL UNIQUE,
  invited_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  accepted_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(organization_id, created_at DESC);
-- At most one live invitation per organization + email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invitations_live
  ON organization_invitations(organization_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('010_hiring_team') ON CONFLICT DO NOTHING;
COMMIT;
