-- Adaptive strategy versions — the versioned, auto-tunable TACTICS layer of the
-- mission prompt and the audit trail of every revision the self-improving loop
-- proposes.
--
-- Self-improving loop (SAFETY-CRITICAL, real-money autonomous trading):
-- after a mission finalizes and its retrospective is banked (mission_retrospectives,
-- migration 046), a one-shot rewriter consolidates the ADAPTIVE TACTICS section
-- from the banked lessons. The rewriter NEVER sees or edits the IMMUTABLE SAFETY
-- CORE (capital cap, sellability/honeypot gate, stop-loss, primary-wallet-only,
-- deadline/token-budget, force-liquidate) — that is pinned from source and
-- concatenated separately into every mission prompt.
--
-- This table stores EVERY proposed revision (accepted, pending, or rejected) so
-- no prior version is ever mutated or destroyed — rollback, reset-to-baseline,
-- and a full audit of "which mission + which lessons drove each change" are all
-- reads over this immutable append-only log.
--
--   status:
--     'baseline'   the human seed (version_no 0), regenerated from source on reset
--     'pending'    a proposed revision awaiting human approval (default posture)
--     'active'     the live version injected into mission prompts (exactly one)
--     'archived'   a formerly-active version, superseded or rolled back away from
--     'rejected'   a revision a guardrail (pattern scan / safety judge / bounds)
--                  refused — kept for audit, never activated
--
--   active           exactly one row is TRUE — the version live missions run under
--   is_baseline      the immutable human seed (reset-to-baseline re-activates it)
--   driving_*        provenance: the mission run + lessons that motivated the row
--   audit_json       diff (old→new), judge verdict, and gate results for the change
--   rejection_reason why a guardrail refused a 'rejected' row (human-readable)

CREATE TABLE strategy_versions (
  id                     TEXT NOT NULL PRIMARY KEY,
  version_no             INTEGER NOT NULL,
  content                TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  is_baseline            BOOLEAN NOT NULL DEFAULT FALSE,
  active                 BOOLEAN NOT NULL DEFAULT FALSE,
  driving_mission_run_id TEXT REFERENCES mission_runs(id),
  driving_lessons_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason       TEXT,
  audit_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  model                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at           TIMESTAMPTZ
);

-- At most ONE live version at a time — the partial unique index makes a second
-- active row a write-time error, so the "which version do live missions run?"
-- question always has a single deterministic answer.
CREATE UNIQUE INDEX strategy_versions_active_uidx
  ON strategy_versions (active)
  WHERE active = TRUE;

-- Monotonic proposal sequence (baseline = 0). Every proposal — accepted OR
-- rejected — consumes the next number so the audit log reads as a clean history.
CREATE UNIQUE INDEX strategy_versions_version_no_uidx
  ON strategy_versions (version_no);

-- Audit reads: newest-first within a status (e.g. list pending approvals).
CREATE INDEX strategy_versions_status_idx
  ON strategy_versions (status, created_at DESC);
