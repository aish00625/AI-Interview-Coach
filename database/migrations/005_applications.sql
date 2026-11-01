-- 005_applications.sql (Phase C, additive). Requires 002, 003, 004.
-- A candidate's application to a job, its status history, and private hirer notes.
-- Rollback: 005_applications.down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS applications (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT NOT NULL REFERENCES job_openings(id) ON DELETE RESTRICT,
  candidate_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id     BIGINT NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
  cover_note    TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'rejected', 'hired', 'withdrawn')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_resume ON applications(resume_id);

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS application_status_history (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    VARCHAR(20),
  to_status      VARCHAR(20) NOT NULL,
  changed_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_history_app ON application_status_history(application_id, id);

-- Private to the hiring organization; never returned to candidates.
CREATE TABLE IF NOT EXISTS application_notes (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body           TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_notes_app ON application_notes(application_id, id);

INSERT INTO schema_migrations (version) VALUES ('005_applications') ON CONFLICT DO NOTHING;
COMMIT;
