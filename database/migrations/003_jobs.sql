-- 003_jobs.sql  (Phase B, additive)  Requires 001, 002.
-- Job openings owned by an organization, and the skills each job requires
-- (re-using the existing `skills` lookup table). Rollback: 003_jobs.down.sql
BEGIN;

CREATE TABLE IF NOT EXISTS job_openings (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title                 VARCHAR(150) NOT NULL,
  description           TEXT NOT NULL,
  location              VARCHAR(150),
  employment_type       VARCHAR(20) NOT NULL DEFAULT 'full_time'
                          CHECK (employment_type IN ('full_time', 'part_time', 'internship', 'contract')),
  experience_level      VARCHAR(20) NOT NULL DEFAULT 'any'
                          CHECK (experience_level IN ('fresher', 'experienced', 'any')),
  eligibility_criteria  TEXT,
  closes_at             TIMESTAMPTZ,
  status                VARCHAR(20) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'open', 'closed')),
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_openings_org ON job_openings(organization_id);
CREATE INDEX IF NOT EXISTS idx_job_openings_status ON job_openings(status);

DROP TRIGGER IF EXISTS trg_job_openings_updated_at ON job_openings;
CREATE TRIGGER trg_job_openings_updated_at
  BEFORE UPDATE ON job_openings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS job_required_skills (
  job_id        BIGINT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  skill_id      BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  is_mandatory  BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (job_id, skill_id)
);

INSERT INTO schema_migrations (version) VALUES ('003_jobs') ON CONFLICT DO NOTHING;
COMMIT;
