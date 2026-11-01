-- 014_user_goals.sql (additive). Requires 001.
-- One optional row per candidate holding the weekly practice goals THEY chose. There is no default row and no
-- default value: a candidate who never set goals simply has no row, and the app shows "set a goal" instead of
-- inventing a target. Progress towards a goal is computed from real practice records when read; it is not stored.
-- Rollback: 014_user_goals.down.sql (drops only this table).
BEGIN;

CREATE TABLE IF NOT EXISTS user_goals (
  user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weekly_interviews  SMALLINT NOT NULL CHECK (weekly_interviews BETWEEN 0 AND 50),
  weekly_problems    SMALLINT NOT NULL CHECK (weekly_problems BETWEEN 0 AND 200),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('014_user_goals') ON CONFLICT DO NOTHING;
COMMIT;
