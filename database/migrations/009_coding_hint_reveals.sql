-- 009_coding_hint_reveals.sql (Phase I, additive). Requires 007 (coding_problems.hints).
-- Records which tiered hint a candidate has revealed for a problem, so hints are revealed one level at a time
-- (a candidate cannot jump straight to the last hint) and reveal counts can later inform weak-topic practice.
-- Hints are never offered for problems in an active job assessment (enforced in the API, not just the UI).
-- Rollback: 009_coding_hint_reveals.down.sql (drops the table; problems and submissions are untouched)
BEGIN;
CREATE TABLE IF NOT EXISTS coding_hint_reveals (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id   BIGINT NOT NULL REFERENCES coding_problems(id) ON DELETE CASCADE,
  level        SMALLINT NOT NULL CHECK (level >= 1),
  revealed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, problem_id, level)
);
CREATE INDEX IF NOT EXISTS idx_coding_hint_reveals_problem ON coding_hint_reveals(problem_id);
INSERT INTO schema_migrations (version) VALUES ('009_coding_hint_reveals') ON CONFLICT DO NOTHING;
COMMIT;
