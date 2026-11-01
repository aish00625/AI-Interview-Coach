-- ============================================================================
-- AI Interview Coach + Coding Round Analyzer
-- PostgreSQL schema — Phase 1
-- ============================================================================
-- Run with:  psql -U <user> -d ai_interview_coach -f schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extension for UUID generation (optional — this schema uses BIGSERIAL ids
-- for simplicity/readability; switch to UUIDs later if you need
-- non-guessable public IDs, e.g. for shareable session links)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Reusable "touch updated_at" trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. USERS & PROFILES
-- ============================================================================

CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lookup table for skills (Java, React, SQL, ...) — normalized so the
-- frontend can offer a dropdown/autocomplete and you can query
-- "all users who know React" without parsing text.
CREATE TABLE skills (
  id    BIGSERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
);

-- Lookup table for interview/coding topics (OOP, DBMS, Arrays, DP, Graphs...)
-- Used by interview_questions, coding_problems, and recommended_questions
-- so "weak topic" analytics are a simple GROUP BY instead of text matching.
CREATE TABLE topics (
  id    BIGSERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE profiles (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  target_role         VARCHAR(100),
  experience_level    VARCHAR(20) NOT NULL DEFAULT 'fresher'
                        CHECK (experience_level IN ('fresher', 'experienced')),
  preferred_language  VARCHAR(20) NOT NULL DEFAULT 'javascript'
                        CHECK (preferred_language IN ('cpp', 'java', 'python', 'javascript')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Many-to-many: a user has many skills, a skill belongs to many users
CREATE TABLE user_skills (
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id  BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);

-- ============================================================================
-- 2. INTERVIEW SESSIONS, QUESTIONS, ANSWERS
-- ============================================================================

CREATE TABLE interview_sessions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interview_type  VARCHAR(20) NOT NULL
                    CHECK (interview_type IN ('technical', 'behavioral', 'hr', 'mixed')),
  target_role     VARCHAR(100) NOT NULL,
  difficulty      VARCHAR(10) NOT NULL
                    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  status          VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  final_score     NUMERIC(5,2),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_interview_sessions_user_id ON interview_sessions(user_id);

CREATE TABLE interview_questions (
  id            BIGSERIAL PRIMARY KEY,
  session_id    BIGINT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  topic_id      BIGINT REFERENCES topics(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  order_index   INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, order_index)
);

CREATE INDEX idx_interview_questions_session_id ON interview_questions(session_id);
CREATE INDEX idx_interview_questions_topic_id ON interview_questions(topic_id);

CREATE TABLE interview_answers (
  id                      BIGSERIAL PRIMARY KEY,
  question_id             BIGINT NOT NULL UNIQUE REFERENCES interview_questions(id) ON DELETE CASCADE,
  answer_text             TEXT,
  audio_transcript        TEXT,
  technical_score         NUMERIC(5,2) CHECK (technical_score BETWEEN 0 AND 100),
  relevance_score         NUMERIC(5,2) CHECK (relevance_score BETWEEN 0 AND 100),
  clarity_score           NUMERIC(5,2) CHECK (clarity_score BETWEEN 0 AND 100),
  completeness_score      NUMERIC(5,2) CHECK (completeness_score BETWEEN 0 AND 100),
  strengths               JSONB NOT NULL DEFAULT '[]',
  weaknesses              JSONB NOT NULL DEFAULT '[]',
  suggested_improvement   TEXT,
  model_answer            TEXT,
  speech_metrics          JSONB,   -- { wpm, filler_word_count, pause_count, duration_sec }
  cv_metrics              JSONB,   -- { face_presence_pct, head_orientation_summary }
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_interview_answers_question_id ON interview_answers(question_id);

-- ============================================================================
-- 3. CODING PROBLEMS & SUBMISSIONS
-- ============================================================================

CREATE TABLE coding_problems (
  id            BIGSERIAL PRIMARY KEY,
  topic_id      BIGINT REFERENCES topics(id) ON DELETE SET NULL,
  title         VARCHAR(200) NOT NULL,
  description   TEXT NOT NULL,
  difficulty    VARCHAR(10) NOT NULL
                  CHECK (difficulty IN ('easy', 'medium', 'hard')),
  constraints   TEXT,
  examples      JSONB NOT NULL DEFAULT '[]',   -- [{input, output, explanation}]
  test_cases    JSONB NOT NULL DEFAULT '[]',   -- [{input, expected_output, is_hidden}]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coding_problems_topic_id ON coding_problems(topic_id);
CREATE INDEX idx_coding_problems_difficulty ON coding_problems(difficulty);

CREATE TABLE coding_submissions (
  id                          BIGSERIAL PRIMARY KEY,
  user_id                     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id                  BIGINT NOT NULL REFERENCES coding_problems(id) ON DELETE RESTRICT,
  session_id                  BIGINT REFERENCES interview_sessions(id) ON DELETE SET NULL,
  language                    VARCHAR(20) NOT NULL
                                CHECK (language IN ('cpp', 'java', 'python', 'javascript')),
  source_code                 TEXT NOT NULL,
  test_cases_passed           INTEGER NOT NULL DEFAULT 0,
  test_cases_total            INTEGER NOT NULL DEFAULT 0,
  execution_time_ms           INTEGER,
  memory_used_kb              INTEGER,
  time_complexity_estimate    VARCHAR(50),
  space_complexity_estimate   VARCHAR(50),
  code_quality_score          NUMERIC(5,2) CHECK (code_quality_score BETWEEN 0 AND 100),
  status                      VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'passed', 'failed', 'error')),
  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coding_submissions_user_id ON coding_submissions(user_id);
CREATE INDEX idx_coding_submissions_problem_id ON coding_submissions(problem_id);
CREATE INDEX idx_coding_submissions_session_id ON coding_submissions(session_id);

-- ============================================================================
-- 4. PERFORMANCE SCORING & RECOMMENDATIONS
-- ============================================================================

CREATE TABLE performance_scores (
  id                           BIGSERIAL PRIMARY KEY,
  user_id                      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id                   BIGINT REFERENCES interview_sessions(id) ON DELETE CASCADE,
  technical_interview_score    NUMERIC(5,2),
  coding_score                 NUMERIC(5,2),
  communication_score          NUMERIC(5,2),
  overall_score                NUMERIC(5,2),
  calculated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_performance_scores_user_id ON performance_scores(user_id);

CREATE TABLE recommended_questions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id    BIGINT REFERENCES coding_problems(id) ON DELETE CASCADE,
  topic_id      BIGINT REFERENCES topics(id) ON DELETE SET NULL,
  reason        VARCHAR(255),   -- e.g. "weak in hashing (2/6 recent problems solved)"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recommended_questions_user_id ON recommended_questions(user_id);

-- ============================================================================
-- 5. SEED DATA — topics & skills (extend freely)
-- ============================================================================

INSERT INTO topics (name) VALUES
  ('OOP'), ('DBMS'), ('Operating Systems'), ('Networking'), ('System Design'),
  ('Arrays'), ('Strings'), ('Hashing'), ('Linked Lists'), ('Stack'), ('Queue'),
  ('Trees'), ('Graphs'), ('Recursion'), ('Dynamic Programming'),
  ('Sorting'), ('Searching')
ON CONFLICT (name) DO NOTHING;

INSERT INTO skills (name) VALUES
  ('Java'), ('Python'), ('JavaScript'), ('C++'), ('React'), ('Node.js'),
  ('SQL'), ('PostgreSQL'), ('MongoDB'), ('Docker'), ('Spring Boot')
ON CONFLICT (name) DO NOTHING;
