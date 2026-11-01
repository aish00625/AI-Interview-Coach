-- Approves a pending hiring organization from the command line (demo/review helper).
-- Usage:  psql -U postgres -d ai_interview_coach -v org="Acme Corp" -f database/seed/approve_organization.sql
-- (The same can be done in the app by an admin at /admin/organizations.)
\set ON_ERROR_STOP on
UPDATE organizations
   SET status = 'approved', reviewed_at = now()
 WHERE name = :'org'
RETURNING id, name, status;
