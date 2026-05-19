-- 021 — vex-app session soft-delete column.
--
-- Adds the column the GUI uses to hide a session from the sidebar without
-- destroying the underlying conversation. Hard delete is not viable
-- because several engine-owned tables (mission_runs, approval_queue,
-- usage_log, loop_wake_requests, missions) reference sessions(id) without
-- ON DELETE CASCADE — a hard DELETE would either fail on FK constraints
-- or require cascading deletion that races with in-flight engine cycles.
--
-- Soft delete avoids both. `listSessions` / `getSessionById` in
-- vex-app's sessions-db filter `WHERE deleted_at IS NULL`, so the UI
-- treats a soft-deleted row as gone. The engine still sees the row via
-- `SELECT *` + `mapRow`, which is acceptable for now — main enforces a
-- fail-closed guard (`NOT EXISTS active mission_run AND NOT EXISTS
-- pending approval`) before flipping `deleted_at`, so the engine can't
-- be acting on a row the user just removed.
--
-- Idempotent: re-running is a no-op.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
