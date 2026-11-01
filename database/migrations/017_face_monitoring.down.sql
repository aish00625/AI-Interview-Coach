-- Rollback of 017_face_monitoring.sql. Removes only face-monitoring sessions and events; no interview, answer, score,
-- coding or account data is touched.
BEGIN;
DROP TABLE IF EXISTS face_monitoring_events;
DROP TABLE IF EXISTS face_monitoring_sessions;
DELETE FROM schema_migrations WHERE version = '017_face_monitoring';
COMMIT;
