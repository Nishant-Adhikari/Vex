-- Mission results ledger. One row per mission RUN, opened when the run starts
-- and closed when it reaches a terminal status. Gives every mission a stable
-- per-wallet number (#N) and a persisted, comparable PNL record so performance
-- can be tracked over time.
--
-- PNL is denominated in ETH (the bankroll's own unit): bankroll_end_eth minus
-- bankroll_start_eth, where bankroll = native ETH + WETH read from proj_balances.
-- This nets out gas/fees/slippage automatically (the honest number). Token bags
-- still held at close are recorded in open_positions_json and EXCLUDED from the
-- headline PNL so an unsold position never distorts it. USD-at-close prices are
-- kept only for display tooltips.

CREATE TABLE mission_results (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  mission_run_id TEXT NOT NULL REFERENCES mission_runs(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  wallet_address TEXT NOT NULL,
  chain_id BIGINT NOT NULL,
  seq_no INTEGER NOT NULL,                 -- per-wallet "Mission #N"
  goal_snippet TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_s INTEGER,
  bankroll_start_eth NUMERIC,
  bankroll_end_eth NUMERIC,
  pnl_eth NUMERIC,
  pnl_pct NUMERIC,
  eth_price_usd_start NUMERIC,             -- display-only (USD tooltip)
  eth_price_usd_end NUMERIC,               -- display-only (USD tooltip)
  trades INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  rotations INTEGER NOT NULL DEFAULT 0,
  vetoes INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'running', -- running|completed|cancelled|failed|stopped
  open_positions_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one ledger row per run (open/close lifecycle keys on this).
CREATE UNIQUE INDEX mission_results_run_uidx ON mission_results (mission_run_id);

-- Per-wallet numbering + history reads (newest first).
CREATE INDEX mission_results_wallet_idx
  ON mission_results (LOWER(wallet_address), seq_no DESC);
