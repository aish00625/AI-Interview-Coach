-- 018_hirer_assessments.sql (additive). Requires 002, 003, 005, 007, 017. Rollback: 018_hirer_assessments.down.sql.
--
-- Hirer-built assessments for a job: aptitude MCQs, technical MCQs and coding problems from the existing catalogue.
--   mcq_questions          organization-owned question bank; correct_keys is NEVER selected by candidate queries
--   assessments            one definition per (job, version); draft -> published -> closed
--   assessment_sections    aptitude / technical / coding, with order, timing and navigation rules
--   assessment_items       one MCQ or one existing coding problem per row (the coding bank is not duplicated)
--   assessment_reviewers   which organization members may review a given assessment (reviewers see only these)
--   assessment_invitations which applications were invited (eligibility comes from the application + its consent)
--   assessment_attempts    server-timed attempts; scores are computed by the server at submission or expiry
--   assessment_answers     autosaved MCQ selections, scored server-side
--   assessment_coding_submissions  coding runs through the existing Docker executor (hidden tests never stored here)
--   assessment_review_notes        reviewer notes; the hiring decision itself stays on the application (human)
-- Monitoring reuses face_monitoring_sessions/events (017): sessions started for an attempt carry assessment_attempt_id.
-- Monitoring data is never part of any score column. Nothing existing is altered except that one new nullable column.
BEGIN;

CREATE TABLE IF NOT EXISTS mcq_questions (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  section_kind     VARCHAR(12) NOT NULL CHECK (section_kind IN ('aptitude', 'technical')),
  category         VARCHAR(40) NOT NULL,
  question_type    VARCHAR(10) NOT NULL DEFAULT 'single' CHECK (question_type IN ('single', 'multiple')),
  question_text    TEXT NOT NULL CHECK (length(question_text) BETWEEN 5 AND 4000),
  choices          JSONB NOT NULL,             -- [{ "key": "A", "text": "..." }, ...]  (4-8, validated in the service)
  correct_keys     JSONB NOT NULL,             -- ["A"] or ["A","C"]: server-side only
  explanation      TEXT CHECK (explanation IS NULL OR length(explanation) <= 4000),
  difficulty       VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  marks            NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (marks > 0 AND marks <= 100),
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  archived_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcq_questions_org ON mcq_questions(organization_id, section_kind) WHERE archived_at IS NULL;
DROP TRIGGER IF EXISTS trg_mcq_questions_updated_at ON mcq_questions;
CREATE TRIGGER trg_mcq_questions_updated_at BEFORE UPDATE ON mcq_questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS assessments (
  id                 BIGSERIAL PRIMARY KEY,
  organization_id    BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id             BIGINT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  title              VARCHAR(200) NOT NULL CHECK (length(title) >= 3),
  description        TEXT CHECK (description IS NULL OR length(description) <= 4000),
  instructions       TEXT CHECK (instructions IS NULL OR length(instructions) <= 8000),
  duration_minutes   INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  available_from     TIMESTAMPTZ,
  available_until    TIMESTAMPTZ,
  max_attempts       SMALLINT NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 5),
  pass_percent       NUMERIC(5,2) CHECK (pass_percent IS NULL OR (pass_percent >= 0 AND pass_percent <= 100)),
  monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
  status             VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  parent_id          BIGINT REFERENCES assessments(id) ON DELETE SET NULL,
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at       TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (available_from IS NULL OR available_until IS NULL OR available_until > available_from)
);
CREATE INDEX IF NOT EXISTS idx_assessments_org ON assessments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_assessments_job ON assessments(job_id);
DROP TRIGGER IF EXISTS trg_assessments_updated_at ON assessments;
CREATE TRIGGER trg_assessments_updated_at BEFORE UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS assessment_sections (
  id                BIGSERIAL PRIMARY KEY,
  assessment_id     BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  kind              VARCHAR(12) NOT NULL CHECK (kind IN ('aptitude', 'technical', 'coding')),
  position          SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  duration_minutes  INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600),
  allow_back        BOOLEAN NOT NULL DEFAULT true,
  randomize         BOOLEAN NOT NULL DEFAULT false,
  negative_marking  NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (negative_marking >= 0 AND negative_marking <= 1),
  UNIQUE (assessment_id, kind),
  UNIQUE (assessment_id, position)
);

CREATE TABLE IF NOT EXISTS assessment_items (
  id                 BIGSERIAL PRIMARY KEY,
  section_id         BIGINT NOT NULL REFERENCES assessment_sections(id) ON DELETE CASCADE,
  position           SMALLINT NOT NULL CHECK (position >= 1),
  mcq_question_id    BIGINT REFERENCES mcq_questions(id) ON DELETE RESTRICT,
  coding_problem_id  BIGINT REFERENCES coding_problems(id) ON DELETE RESTRICT,
  marks              NUMERIC(6,2) NOT NULL CHECK (marks > 0 AND marks <= 100),
  CHECK ((mcq_question_id IS NULL) <> (coding_problem_id IS NULL)),
  UNIQUE (section_id, position)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_items_mcq ON assessment_items(section_id, mcq_question_id) WHERE mcq_question_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_items_coding ON assessment_items(section_id, coding_problem_id) WHERE coding_problem_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_items_mcq ON assessment_items(mcq_question_id) WHERE mcq_question_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assessment_reviewers (
  assessment_id  BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, user_id)
);

CREATE TABLE IF NOT EXISTS assessment_invitations (
  id              BIGSERIAL PRIMARY KEY,
  assessment_id   BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  application_id  BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  invited_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, application_id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_invitations_app ON assessment_invitations(application_id);

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id                  BIGSERIAL PRIMARY KEY,
  invitation_id       BIGINT NOT NULL REFERENCES assessment_invitations(id) ON DELETE CASCADE,
  assessment_id       BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  candidate_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_no          SMALLINT NOT NULL CHECK (attempt_no >= 1),
  status              VARCHAR(12) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at         TIMESTAMPTZ NOT NULL,
  submitted_at        TIMESTAMPTZ,
  consent_version     VARCHAR(30) NOT NULL,
  consented_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  monitoring_choice   VARCHAR(14) NOT NULL CHECK (monitoring_choice IN ('camera', 'alternative', 'not_required')),
  accommodation_note  TEXT CHECK (accommodation_note IS NULL OR length(accommodation_note) <= 1000),
  item_order          JSONB NOT NULL,          -- { "<sectionId>": [itemId, ...] } fixed at start (randomized when configured)
  section_state       JSONB NOT NULL,          -- { "entered": { "<sectionId>": iso }, "locked": [sectionId, ...] }
  section_scores      JSONB,                   -- filled by the server at submission/expiry: { "<kind>": { score, max } }
  total_score         NUMERIC(8,2),
  max_score           NUMERIC(8,2),
  meets_pass_mark     BOOLEAN,                 -- informational only; never changes an application's status
  review_status       VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'in_review', 'reviewed')),
  UNIQUE (invitation_id, attempt_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_attempts_one_open ON assessment_attempts(invitation_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_assessment ON assessment_attempts(assessment_id, status);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_candidate ON assessment_attempts(candidate_id);

CREATE TABLE IF NOT EXISTS assessment_answers (
  attempt_id     BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  item_id        BIGINT NOT NULL REFERENCES assessment_items(id) ON DELETE CASCADE,
  selected_keys  JSONB NOT NULL DEFAULT '[]',
  saved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_correct     BOOLEAN,                      -- set by the server at submission/expiry
  awarded        NUMERIC(6,2),
  PRIMARY KEY (attempt_id, item_id)
);

CREATE TABLE IF NOT EXISTS assessment_coding_submissions (
  id                 BIGSERIAL PRIMARY KEY,
  attempt_id         BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  item_id            BIGINT NOT NULL REFERENCES assessment_items(id) ON DELETE CASCADE,
  language           VARCHAR(20) NOT NULL CHECK (language IN ('cpp', 'java', 'python', 'javascript')),
  source_code        TEXT NOT NULL,
  status             VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'error')),
  execution_status   VARCHAR(30),
  tests_passed       INTEGER NOT NULL DEFAULT 0 CHECK (tests_passed >= 0),
  tests_total        INTEGER NOT NULL DEFAULT 0 CHECK (tests_total >= 0),
  execution_time_ms  INTEGER,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_coding_attempt ON assessment_coding_submissions(attempt_id, item_id);

CREATE TABLE IF NOT EXISTS assessment_review_notes (
  id          BIGSERIAL PRIMARY KEY,
  attempt_id  BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  author_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_review_notes_attempt ON assessment_review_notes(attempt_id, id);

-- Reuse of 017: a monitoring session started for an assessment attempt is linked to it (practice sessions stay NULL).
ALTER TABLE face_monitoring_sessions ADD COLUMN IF NOT EXISTS assessment_attempt_id BIGINT REFERENCES assessment_attempts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_face_monitoring_sessions_attempt ON face_monitoring_sessions(assessment_attempt_id) WHERE assessment_attempt_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('018_hirer_assessments') ON CONFLICT DO NOTHING;
COMMIT;
