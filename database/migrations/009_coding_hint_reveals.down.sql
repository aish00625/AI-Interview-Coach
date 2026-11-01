-- Rollback of 009. Drops the hint-reveal log (hints themselves live on coding_problems and are kept).
BEGIN;
DROP TABLE IF EXISTS coding_hint_reveals;
DELETE FROM schema_migrations WHERE version = '009_coding_hint_reveals';
COMMIT;
