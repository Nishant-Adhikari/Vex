-- Phase 4d — autonomous mission auto-retry state on mission_runs.
--
-- Adds the durable state the engine needs to safely auto-retry a paused_error
-- mission run after a TRANSIENT provider/runtime error (<=5x, exponential
-- backoff), in autonomous-FULL mode only:
--
--   error_retry_count  -- how many auto-retries have been scheduled for this run.
--                         Doubles as the retry budget (stop at 5) AND the
--                         wake-claim epoch guard: a scheduled error_retry wake
--                         only resumes when error_retry_count still equals the
--                         attempt it was scheduled for (a consumed wake whose
--                         epoch has moved on is skipped).
--   auto_retry_unsafe  -- STICKY fail-closed stamp. Set true (and NEVER cleared
--                         within the run's life) the instant the run is about to
--                         dispatch any MUTATING tool. An error that arrives after
--                         a side effect can then never auto-retry — full mode has
--                         no approval backstop, so this is the double-spend gate.
--
-- The opt-in itself (autoRetryEnabled) rides the mission constraints and is
-- frozen into contract_snapshot_json at run start, so no column is needed here.
--
-- Idempotent (027 style): IF NOT EXISTS + NOT NULL with safe defaults. The dev
-- DB line is empty, so no backfill is required.

ALTER TABLE mission_runs ADD COLUMN IF NOT EXISTS error_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mission_runs ADD COLUMN IF NOT EXISTS auto_retry_unsafe BOOLEAN NOT NULL DEFAULT false;
