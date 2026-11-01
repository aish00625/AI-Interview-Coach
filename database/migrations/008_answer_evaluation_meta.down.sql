-- Rollback of 008. Drops evaluation_meta (confidence notes and matched/missing criteria are lost; answers and scores are kept).
BEGIN;
ALTER TABLE interview_answers DROP COLUMN IF EXISTS evaluation_meta;
DELETE FROM schema_migrations WHERE version = '008_answer_evaluation_meta';
COMMIT;
