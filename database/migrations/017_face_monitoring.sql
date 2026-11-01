-- 017_face_monitoring.sql (additive). Requires 001 and 016. Rollback: 017_face_monitoring.down.sql.
-- Optional, consent-based Face Monitoring for PRACTICE sessions. Additive only: two new tables, nothing existing is changed.
--  * face_monitoring_sessions : one monitoring run owned by one candidate. Holds consent, the feature availability that was
--    true when it started, the thresholds used, the small running state of the timing engine, and the final report.
--  * face_monitoring_events   : measured observations (start, end, duration, confidence, explanation). Observations are NOT
--    findings of misconduct and are never part of an interview score.
-- No video, image, face template or embedding is stored. Rows are deleted with the candidate, on request, or when
-- retention_until passes (default 30 days).
BEGIN;

CREATE TABLE IF NOT EXISTS face_monitoring_sessions (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interview_session_id  BIGINT REFERENCES interview_sessions(id) ON DELETE SET NULL,
  status                VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  consent_version       VARCHAR(20) NOT NULL,
  consented_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  identity_consent      BOOLEAN NOT NULL DEFAULT false,
  identity_status       VARCHAR(20) NOT NULL DEFAULT 'not_requested',
  reference_key         VARCHAR(64),          -- opaque random key for the in-memory reference in the AI service; not biometric data
  features              JSONB NOT NULL,       -- what could be measured when the session started
  config                JSONB NOT NULL,       -- thresholds used (so a report is explainable later)
  engine_state          JSONB NOT NULL,       -- running totals and open runs; small, rewritten on each frame
  report                JSONB,                -- filled when the session ends
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  paused_ms             BIGINT NOT NULL DEFAULT 0 CHECK (paused_ms >= 0),
  retention_until       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_face_monitoring_sessions_user ON face_monitoring_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_face_monitoring_sessions_retention ON face_monitoring_sessions(retention_until);
-- At most one running (active or paused) monitoring session per candidate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_face_monitoring_one_running ON face_monitoring_sessions(user_id) WHERE status IN ('active', 'paused');

CREATE TABLE IF NOT EXISTS face_monitoring_events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES face_monitoring_sessions(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   VARCHAR(40) NOT NULL,
  category     VARCHAR(20) NOT NULL CHECK (category IN ('observation', 'warning', 'technical_issue', 'review_recommended')),
  status       VARCHAR(10) NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'resolved')),
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  duration_ms  BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  confidence   NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  explanation  TEXT NOT NULL,
  evidence     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_face_monitoring_events_session ON face_monitoring_events(session_id, started_at);

INSERT INTO schema_migrations (version) VALUES ('017_face_monitoring') ON CONFLICT DO NOTHING;
COMMIT;
