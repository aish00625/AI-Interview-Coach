-- Makes an EXISTING registered user an admin (so they can approve hiring organizations).
-- Usage:  psql -U postgres -d ai_interview_coach -v email="you@example.com" -f database/seed/promote_admin.sql
-- Rollback: UPDATE users SET role='candidate' WHERE email='you@example.com';
\set ON_ERROR_STOP on
UPDATE users SET role = 'admin' WHERE email = lower(:'email') RETURNING id, email, name, role;
