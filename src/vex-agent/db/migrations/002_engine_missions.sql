-- Vex — engine & missions schema
-- Additive split: 001_initial.sql = foundation, this file = engine/mission extensions.

-- ══════════════════════════════════════════════════════════════════
-- A. Missions
-- ══════════════════════════════════════════════════════════════════

-- Mission — two-phase contract: setup (guided draft) → run (autonomous execution)
CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  root_session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  goal TEXT,
  constraints_json JSONB DEFAULT '{}',
  success_criteria_json JSONB DEFAULT '[]',
  stop_conditions_json JSONB DEFAULT '[]',
  risk_profile TEXT,
  capital_source_json JSONB DEFAULT '{}',
  allowed_protocols TEXT[] DEFAULT '{}',
  allowed_chains TEXT[] DEFAULT '{}',
  allowed_wallets TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX idx_missions_session ON missions(root_session_id);
CREATE INDEX idx_missions_status ON missions(status);

-- Mission runs — per-run state. NO parent_run_id (session_links is canonical).
CREATE TABLE mission_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_checkpoint_at TIMESTAMPTZ,
  stop_reason TEXT,
  stop_summary TEXT,
  stop_evidence_json JSONB,
  iteration_count INTEGER DEFAULT 0
);
CREATE INDEX idx_mission_runs_mission ON mission_runs(mission_id);
CREATE INDEX idx_mission_runs_session ON mission_runs(session_id);
CREATE INDEX idx_mission_runs_status ON mission_runs(status);

-- ══════════════════════════════════════════════════════════════════
-- B. Message metadata extensions
-- ══════════════════════════════════════════════════════════════════

-- Engine metadata on messages — source, type, visibility, cross-session refs.
-- CRITICAL: messages_archive must have identical columns because
-- archiveMessages() does DELETE...RETURNING * → INSERT INTO messages_archive SELECT *.

ALTER TABLE messages ADD COLUMN source TEXT DEFAULT 'user';
ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'chat';
ALTER TABLE messages ADD COLUMN visibility TEXT DEFAULT 'user';
ALTER TABLE messages ADD COLUMN origin_session_id TEXT;
ALTER TABLE messages ADD COLUMN subagent_id TEXT;
-- PR-7: free-form metadata envelope for engine-written messages (wake banners,
-- overflow stubs, etc.). Shape is validated in code — keep schema open so new
-- payload kinds don't require a migration.
ALTER TABLE messages ADD COLUMN metadata JSONB;

ALTER TABLE messages_archive ADD COLUMN source TEXT DEFAULT 'user';
ALTER TABLE messages_archive ADD COLUMN message_type TEXT DEFAULT 'chat';
ALTER TABLE messages_archive ADD COLUMN visibility TEXT DEFAULT 'user';
ALTER TABLE messages_archive ADD COLUMN origin_session_id TEXT;
ALTER TABLE messages_archive ADD COLUMN subagent_id TEXT;
ALTER TABLE messages_archive ADD COLUMN metadata JSONB;
