-- 004_resumes.sql (Phase C, additive). Requires 001.
-- Resume METADATA + extracted text. The file itself lives on disk under RESUME_STORAGE_DIR,
-- referenced only by the random storage_key (never by the user-supplied filename).
-- Rollback: 004_resumes.down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS resumes (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  content_type      VARCHAR(100) NOT NULL
                      CHECK (content_type IN ('application/pdf',
                                              'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0),
  storage_key       VARCHAR(80) NOT NULL UNIQUE,
  extracted_text    TEXT,
  extraction_status VARCHAR(20) NOT NULL DEFAULT 'unsupported'
                      CHECK (extraction_status IN ('ok', 'empty', 'unsupported', 'failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('004_resumes') ON CONFLICT DO NOTHING;
COMMIT;
