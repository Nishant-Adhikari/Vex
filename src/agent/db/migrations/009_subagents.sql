-- 009: Subagent system

CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  allow_trades BOOLEAN DEFAULT FALSE,
  parent_session_id TEXT,
  session_id TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  result TEXT,
  error TEXT,
  token_cost_og NUMERIC DEFAULT 0,
  iterations INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 25
);
CREATE INDEX IF NOT EXISTS idx_subagents_status ON subagents(status);
CREATE INDEX IF NOT EXISTS idx_subagents_parent ON subagents(parent_session_id);
