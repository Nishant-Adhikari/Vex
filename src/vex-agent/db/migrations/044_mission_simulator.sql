-- Mission Simulator (dry-run / paper-trading) — mode axis + shadow ledger.
--
-- A mission run with mode='simulator' runs the FULL agent loop identically but
-- NEVER touches the wallet or broadcasts a transaction: swaps are paper-filled
-- from the live quote and recorded here as shadow trades / positions. The mode
-- is IMMUTABLE per run — frozen on `mission_runs.mode` at run start (the same
-- pattern as the frozen contract snapshot) and never derived from mutable state
-- mid-run. `sessions.mission_mode` records the session's intended mode so the
-- run inherits it at createRun and so hydration can resolve it before a run
-- exists. Both default to 'live' so every existing row and every UI-created
-- session/run stays live with zero behavioural change.
--
-- IDEMPOTENT BY CONSTRUCTION (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
-- EXISTS) so re-running against a hand-reconciled dev database is a no-op.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mission_mode TEXT NOT NULL DEFAULT 'live'
    CHECK (mission_mode IN ('live', 'simulator'));

ALTER TABLE mission_runs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'live'
    CHECK (mode IN ('live', 'simulator'));

-- Surface the SIM marker on the per-run ledger so the missions history + the
-- persistent Active Missions bar can badge a simulator run without a join.
ALTER TABLE mission_results
  ADD COLUMN IF NOT EXISTS simulated BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Shadow ledger ─────────────────────────────────────────────────────────
-- Fully isolated from the real wallet/balance/PnL tables. Keyed by
-- mission_run_id so a simulator run's paper portfolio can never collide with a
-- real mission's projections or another sim run's.

-- One row per paper-filled swap leg.
CREATE TABLE IF NOT EXISTS sim_trades (
  id                 TEXT NOT NULL PRIMARY KEY,
  mission_run_id     TEXT NOT NULL REFERENCES mission_runs(id),
  session_id         TEXT NOT NULL REFERENCES sessions(id),
  chain              TEXT NOT NULL,
  dex                TEXT NOT NULL,
  side               TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  token_address      TEXT NOT NULL,      -- the NON-native (traded) token
  token_symbol       TEXT NOT NULL,
  -- Signed token quantity delta from this leg (buy: +amountOut, sell: -amountIn).
  token_qty          NUMERIC NOT NULL,
  -- Native value moved by this leg (buy: amountIn spent; sell: amountOut received).
  -- NULL for a token<->token leg with no native anchor.
  native_value       NUMERIC,
  price_impact       NUMERIC,
  -- Realized paper PnL in native units (sells only; NULL for buys).
  realized_pnl_native NUMERIC,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sim_trades_run_idx ON sim_trades (mission_run_id, created_at);

-- One row per (run, chain, token) shadow position. Cost basis + realized PnL
-- are accumulated in native units as buys/sells are paper-filled.
CREATE TABLE IF NOT EXISTS sim_positions (
  id                  TEXT NOT NULL PRIMARY KEY,
  mission_run_id      TEXT NOT NULL REFERENCES mission_runs(id),
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  chain               TEXT NOT NULL,
  token_address       TEXT NOT NULL,
  token_symbol        TEXT NOT NULL,
  qty                 NUMERIC NOT NULL DEFAULT 0,       -- current held quantity
  cost_native         NUMERIC NOT NULL DEFAULT 0,        -- native cost basis of held qty
  realized_pnl_native NUMERIC NOT NULL DEFAULT 0,        -- cumulative realized paper PnL
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one position row per (run, chain, token) — buys/sells upsert into it.
CREATE UNIQUE INDEX IF NOT EXISTS sim_positions_run_token_uidx
  ON sim_positions (mission_run_id, chain, LOWER(token_address));
