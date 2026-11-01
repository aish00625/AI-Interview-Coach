-- 015_local_ai.sql (additive). Requires 001. Rollback: 015_local_ai.down.sql.
-- Phase O: storage for the local-AI features. Additive only: two new tables, nothing existing is changed.
--  * interview_followups : the extra turns of a multi-turn practice interview. Kept apart from interview_answers on
--    purpose, so follow-up turns can never change a score, a final score, an analytics figure or a hirer's view.
--  * ai_feedback         : saved AI/rule-based coaching text (STAR coaching, end-of-interview report). Advisory only.
BEGIN;

CREATE TABLE IF NOT EXISTS interview_followups (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question_id  BIGINT NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
  turn_no      SMALLINT NOT NULL CHECK (turn_no BETWEEN 1 AND 3),
  prompt       TEXT NOT NULL,
  source       VARCHAR(12) NOT NULL CHECK (source IN ('local_ai', 'rule_based')),
  model        VARCHAR(100),
  reason       TEXT,
  status       VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'skipped')),
  answer_text  TEXT,
  feedback     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at  TIMESTAMPTZ,
  UNIQUE (question_id, turn_no)
);
CREATE INDEX IF NOT EXISTS idx_interview_followups_session ON interview_followups(session_id);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(20) NOT NULL CHECK (kind IN ('star', 'interview_report')),
  ref_id      BIGINT NOT NULL,          -- interview_questions.id for 'star', interview_sessions.id for 'interview_report'
  source      VARCHAR(12) NOT NULL CHECK (source IN ('local_ai', 'rule_based')),
  model       VARCHAR(100),
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id)
);

INSERT INTO schema_migrations (version) VALUES ('015_local_ai') ON CONFLICT DO NOTHING;
COMMIT;
