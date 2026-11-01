-- 006_job_assessments.sql (Phase D, additive). Requires 003, 005.
-- 1) Per-job assessment configuration (an optional AI interview + a set of coding problems).
-- 2) A nullable application_id on interview_sessions / coding_submissions. NULL = ordinary private practice
--    (all existing rows stay NULL); non-NULL = a hiring assessment for that application.
-- Rollback: 006_job_assessments.down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS job_assessments (
  job_id               BIGINT PRIMARY KEY REFERENCES job_openings(id) ON DELETE CASCADE,
  interview_enabled    BOOLEAN NOT NULL DEFAULT false,
  interview_type       VARCHAR(20) NOT NULL DEFAULT 'technical'
                         CHECK (interview_type IN ('technical', 'behavioral', 'hr', 'mixed')),
  interview_difficulty VARCHAR(10) NOT NULL DEFAULT 'medium'
                         CHECK (interview_difficulty IN ('easy', 'medium', 'hard')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_job_assessments_updated_at ON job_assessments;
CREATE TRIGGER trg_job_assessments_updated_at
  BEFORE UPDATE ON job_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS job_assessment_problems (
  job_id     BIGINT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  problem_id BIGINT NOT NULL REFERENCES coding_problems(id) ON DELETE RESTRICT,
  position   SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, problem_id)
);

ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS application_id BIGINT REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE coding_submissions ADD COLUMN IF NOT EXISTS application_id BIGINT REFERENCES applications(id) ON DELETE CASCADE;

-- At most one interview assessment per application.
CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_sessions_application
  ON interview_sessions(application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coding_submissions_application
  ON coding_submissions(application_id, problem_id) WHERE application_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('006_job_assessments') ON CONFLICT DO NOTHING;
COMMIT;
