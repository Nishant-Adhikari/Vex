-- Plan-mode (session-scoped) — the agent-authored "HOW" that complements a
-- mission's frozen "WHAT" (goal/constraints/allowed_*), and that also works in
-- plain agent sessions (which have no mission draft). Hence session-scoped, not
-- a column on `missions`.
--
-- One row per session (PRIMARY KEY session_id):
--   enabled            -- per-session plan-mode toggle (default OFF; the UI
--                         surfaces it as "recommended"). Gates plan_write
--                         visibility, the dispatcher execution gate, and the
--                         "# Active Plan" prompt layer.
--   plan_md            -- the agent-authored action plan (markdown), length-
--                         capped on write. Re-injected each turn so it re-anchors
--                         the agent after a compaction, and shown to the user.
--   accepted_at        -- NULL = pending acceptance. Set by the host-only
--                         `plan.accept` IPC. ANY content-changing `plan_write`
--                         resets this to NULL (re-accept on edit). While NULL and
--                         enabled, the dispatcher blocks execution tools.
--   off_notice_pending -- one-shot flag: set true when plan-mode is toggled
--                         enabled->disabled while a plan exists, so the next
--                         prompt build emits a single "plan mode off — ask about
--                         next moves" note; cleared on consume / on re-enable.
--
-- ON DELETE CASCADE so deleting a session drops its plan (001 FK style).
-- Idempotent (027/028 style): CREATE TABLE IF NOT EXISTS. Fresh dev DB; no backfill.
-- mission_runs.status is plain TEXT with no CHECK constraint, so the new
-- `paused_plan_acceptance` status needs no status-column migration.

CREATE TABLE IF NOT EXISTS session_plans (
  session_id          TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  plan_md             TEXT NOT NULL DEFAULT '',
  accepted_at         TIMESTAMPTZ NULL,
  off_notice_pending  BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
