-- LP economics — multi-leg cashflow tracking for liquidity positions.
--
-- Projection tables — included in replay truncate + rebuild cycle.
-- NO FK to proj_activity.id or proj_open_positions.id (those are projection-local,
-- unstable across replay). Link via execution_id, capture_item_id, position_key, instrument_key.
--
-- Separate from proj_open_positions lifecycle — that tracks open/close status,
-- this tracks deposit/withdraw/fee/refund legs with per-token amounts.

CREATE TABLE IF NOT EXISTS proj_lp_events (
  id SERIAL PRIMARY KEY,
  execution_id INTEGER NOT NULL,
  capture_item_id INTEGER,
  namespace TEXT NOT NULL,
  chain TEXT NOT NULL,
  action TEXT NOT NULL,
  dex TEXT,
  pool TEXT,
  position_key TEXT,
  instrument_key TEXT,
  wallet_address TEXT NOT NULL,
  total_value_usd NUMERIC,
  fee_collected_usd NUMERIC,
  valuation_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proj_lp_events_position ON proj_lp_events(position_key) WHERE position_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proj_lp_events_namespace ON proj_lp_events(namespace, action);
CREATE INDEX IF NOT EXISTS idx_proj_lp_events_execution ON proj_lp_events(execution_id);

CREATE TABLE IF NOT EXISTS proj_lp_event_legs (
  id SERIAL PRIMARY KEY,
  lp_event_id INTEGER NOT NULL REFERENCES proj_lp_events(id) ON DELETE CASCADE,
  leg_type TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  amount_raw TEXT NOT NULL,
  amount_usd NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proj_lp_legs_event ON proj_lp_event_legs(lp_event_id);
