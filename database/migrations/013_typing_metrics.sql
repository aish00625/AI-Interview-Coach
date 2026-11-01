-- 013_typing_metrics.sql (additive). Requires the base schema (interview_answers).
-- Adds interview_answers.typing_metrics: sanitised, server-derived typing-behaviour measurements for PRIVATE PRACTICE text
-- answers (typing speed, corrections, pauses, paste share). Nullable: existing answers, voice answers and hiring-assessment
-- answers simply have NULL. It is shown only to the candidate who owns the answer and is never selected by hirer queries.
-- Rollback: 013_typing_metrics.down.sql  (drops the column; answers and scores are kept)
BEGIN;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS typing_metrics JSONB;
INSERT INTO schema_migrations (version) VALUES ('013_typing_metrics') ON CONFLICT DO NOTHING;
COMMIT;
