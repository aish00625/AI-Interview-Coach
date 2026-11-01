-- Rollback of 010. Drops invitations. Members with the 'reviewer' role are REMOVED from their organization
-- (not promoted: promoting them to 'recruiter' would silently grant decision rights). Their user accounts,
-- notes and scorecards are kept. Roll back 011 first if you also want scorecards gone.
BEGIN;
DROP TABLE IF EXISTS organization_invitations;
DELETE FROM organization_members WHERE member_role = 'reviewer';
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
  ADD CONSTRAINT organization_members_member_role_check CHECK (member_role IN ('owner', 'recruiter'));
DELETE FROM schema_migrations WHERE version = '010_hiring_team';
COMMIT;
