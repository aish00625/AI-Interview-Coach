-- 008_answer_evaluation_meta.sql (Phase H, additive). Requires the base schema.
-- Stores the evaluator's optional honesty metadata for each interview answer (confidence level and note, rubric id and kind,
-- matched/missing criteria). Nullable: answers created before this migration simply have NULL and keep working.
-- Candidates see it for their own answers; it is never selected by hirer queries.
-- Rollback: 008_answer_evaluation_meta.down.sql  (drops the column; answers and scores are kept)
BEGIN;
ALTER TABLE interview_answers ADD COLUMN IF NOT EXISTS evaluation_meta JSONB;
INSERT INTO schema_migrations (version) VALUES ('008_answer_evaluation_meta') ON CONFLICT DO NOTHING;
COMMIT;
