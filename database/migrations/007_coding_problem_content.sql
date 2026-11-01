-- 007_coding_problem_content.sql (Phase H, additive). Requires the base schema.
-- Adds a stable identifier and tiered hints to coding problems so the seed script can be re-run safely and
-- hints can be revealed one at a time. Existing problems keep working: slug stays NULL, hints defaults to [].
-- Rollback: 007_coding_problem_content.down.sql  (drops the two columns; the problems themselves are kept)
BEGIN;
ALTER TABLE coding_problems ADD COLUMN IF NOT EXISTS slug  VARCHAR(80);
ALTER TABLE coding_problems ADD COLUMN IF NOT EXISTS hints JSONB NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX IF NOT EXISTS uq_coding_problems_slug ON coding_problems(slug) WHERE slug IS NOT NULL;
INSERT INTO schema_migrations (version) VALUES ('007_coding_problem_content') ON CONFLICT DO NOTHING;
COMMIT;
