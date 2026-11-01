-- 011_review_workflow.sql (Phase J, additive). Requires 003, 005, 010.
--  * job_openings.blind_review     hide identity (name, email, resume, cover note) while an application is under screening
--  * job_openings.scorecard_criteria  optional per-job criteria (JSON array of {key,label}); NULL = platform defaults
--  * application_scorecards / _ratings  one structured scorecard per reviewer per application
--  * application_status_history.reason_code  required, structured reason when an application is rejected
-- Scores are a human reviewer's judgement. Nothing here computes a hiring decision.
-- Rollback: 011_review_workflow.down.sql
BEGIN;

ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS blind_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS scorecard_criteria JSONB;

ALTER TABLE application_status_history ADD COLUMN IF NOT EXISTS reason_code VARCHAR(40);

CREATE TABLE IF NOT EXISTS application_scorecards (
  id              BIGSERIAL PRIMARY KEY,
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  reviewer_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recommendation  VARCHAR(12) NOT NULL CHECK (recommendation IN ('strong_yes', 'yes', 'no', 'strong_no')),
  summary         TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One scorecard per reviewer per application (re-submitting edits it). NULL reviewers (deleted accounts) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scorecard_reviewer ON application_scorecards(application_id, reviewer_id) WHERE reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scorecards_application ON application_scorecards(application_id);

DROP TRIGGER IF EXISTS trg_scorecards_updated_at ON application_scorecards;
CREATE TRIGGER trg_scorecards_updated_at BEFORE UPDATE ON application_scorecards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS application_scorecard_ratings (
  scorecard_id   BIGINT NOT NULL REFERENCES application_scorecards(id) ON DELETE CASCADE,
  criterion_key  VARCHAR(40) NOT NULL,
  criterion_label VARCHAR(80) NOT NULL,
  rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
  PRIMARY KEY (scorecard_id, criterion_key)
);

INSERT INTO schema_migrations (version) VALUES ('011_review_workflow') ON CONFLICT DO NOTHING;
COMMIT;
