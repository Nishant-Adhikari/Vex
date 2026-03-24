-- 008: Echo Loop runtime foundation
-- Session lineage, loop phases, cycle audit, provenance, autonomy inbox

-- Session lineage (scope + parent for querying loop/subagent/telegram sessions)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'chat';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS parent_session_id TEXT;

-- Echo Loop phase tracking on existing loop_state singleton
ALTER TABLE loop_state ADD COLUMN IF NOT EXISTS current_phase TEXT DEFAULT 'idle';
ALTER TABLE loop_state ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMPTZ;
ALTER TABLE loop_state ADD COLUMN IF NOT EXISTS loop_session_id TEXT;

-- Loop cycle audit trail
CREATE TABLE IF NOT EXISTS loop_cycles (
  id SERIAL PRIMARY KEY,
  cycle_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  phases_completed TEXT[] DEFAULT '{}',
  outcome TEXT, -- completed, skipped, error, timeout
  decisions JSONB DEFAULT '{}',
  token_cost_og NUMERIC DEFAULT 0,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_loop_cycles_started ON loop_cycles(started_at DESC);

-- Provenance on approval_queue (track mutation origin)
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat';
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS cycle_id INTEGER;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS subagent_id TEXT;

-- Autonomy inbox (typed event queue consumed by Echo Loop)
CREATE TABLE IF NOT EXISTS autonomy_inbox (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  consumed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autonomy_inbox_pending
  ON autonomy_inbox(consumed, created_at) WHERE consumed = FALSE;
