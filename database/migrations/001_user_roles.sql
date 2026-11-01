-- 001_user_roles.sql  (Phase A, additive)
-- Adds a role to users. Every existing user becomes 'candidate' via the DEFAULT,
-- so existing accounts and all candidate features keep working unchanged.
-- Safe to run more than once. Rollback: 001_user_roles.down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(100) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'candidate';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('candidate', 'hirer', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

INSERT INTO schema_migrations (version) VALUES ('001_user_roles') ON CONFLICT DO NOTHING;
COMMIT;
