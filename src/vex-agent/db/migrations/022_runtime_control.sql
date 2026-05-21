-- Puzzle 03 — runtime control plane (DB-backed pause/stop/resume/wake)
-- + runner leases.
--
-- Two tables:
--
--  1. `runtime_control_requests` — durable user-initiated requests
--     (`pause_after_step`, `stop_terminal`, `resume`, `cancel_wake`).
--     Engine observes pending rows at safe checkpoints, applies the
--     state transition (status flip + wake cancel etc.) atomically with
--     marking the request `observed`/`cleared`. Persistence survives
--     UI restart / main reload — the in-memory `AbortController` of a
--     single IPC call is not sufficient for desktop runtime lifecycle.
--
--  2. `runner_leases` — exclusive runner ownership per session. ONE
--     active runner per session at a time, even across the seven
--     continuation entry points (chat / mission start / setup / recover
--     / retry / approval resume / wake-triggered resume). Re-claim on
--     expiry; heartbeat owned by the active runner handle (TTL 5 min
--     default; heartbeat every TTL/3). Plain SQL CAS via
--     `INSERT ... ON CONFLICT (session_id) DO UPDATE WHERE` so the
--     primary-key unique constraint closes the race between two
--     concurrent first claimants.
--
-- Idempotent via `CREATE ... IF NOT EXISTS`. Forward-only — no DROP in
-- production. `session_id` is TEXT (matches `sessions.id` in
-- `001_initial.sql:138`); `mission_run_id` is TEXT (matches
-- `mission_runs.id` in `002_engine_missions.sql`).

CREATE TABLE IF NOT EXISTS runtime_control_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mission_run_id  TEXT REFERENCES mission_runs(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL
                    CHECK (kind IN ('pause_after_step', 'stop_terminal', 'resume', 'cancel_wake')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'observed', 'cleared', 'expired', 'failed')),
  requested_by    TEXT NOT NULL CHECK (requested_by IN ('user', 'system')),
  reason          TEXT,
  correlation_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observed_at     TIMESTAMPTZ,
  cleared_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

-- Partial index: hot path is "any pending or observed request for this
-- session?" — the engine checkpoint reader runs this on every safe
-- point. Excludes terminal request rows (cleared / expired / failed)
-- from the index footprint.
CREATE INDEX IF NOT EXISTS idx_runtime_control_pending
  ON runtime_control_requests (session_id, created_at ASC)
  WHERE status IN ('pending', 'observed');

CREATE INDEX IF NOT EXISTS idx_runtime_control_run
  ON runtime_control_requests (mission_run_id)
  WHERE mission_run_id IS NOT NULL;

-- Sweep-by-deadline index for the `expireDue` background sweep.
CREATE INDEX IF NOT EXISTS idx_runtime_control_expires
  ON runtime_control_requests (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('pending', 'observed');


CREATE TABLE IF NOT EXISTS runner_leases (
  -- Lease is per-session (NOT per-mission-run) — chat-only sessions
  -- (no mission_run_id) also need single-runner protection so two
  -- rapid chat.submit IPC calls don't fork the turn loop.
  session_id      TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  mission_run_id  TEXT REFERENCES mission_runs(id) ON DELETE SET NULL,
  owner_id        TEXT NOT NULL,
  process_kind    TEXT NOT NULL
                    CHECK (process_kind IN ('electron_main', 'agent_worker', 'test')),
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runner_leases_expires
  ON runner_leases (expires_at);
