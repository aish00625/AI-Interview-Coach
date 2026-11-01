-- 016_score_breakdown.sql (additive). Requires 001. Rollback: 016_score_breakdown.down.sql.
-- Stores HOW a practice interview's final score was calculated (category scores, configured and applied weights, points,
-- which signals were unavailable). Existing sessions keep score_breakdown = NULL and their original final_score; nothing
-- is recalculated or rewritten. Hiring-assessment sessions never get a breakdown (they stay content-only).
BEGIN;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
INSERT INTO schema_migrations (version) VALUES ('016_score_breakdown') ON CONFLICT DO NOTHING;
COMMIT;
