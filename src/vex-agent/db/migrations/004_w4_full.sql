-- W4 Full Closure: benchmark-native PnL, MTM, settlement semantics
-- Additive only. All monetary columns NUMERIC (consistent with W4A).

-- ── proj_activity: benchmark/native/settlement ─────────────────

ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS benchmark_asset_key TEXT;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS settlement_asset_key TEXT;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS input_value_native NUMERIC;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS output_value_native NUMERIC;

-- ── proj_pnl_lots: native cost basis ───────────────────────────
-- No price_native — derived at read-time from cost_basis_native / quantity.

ALTER TABLE proj_pnl_lots ADD COLUMN IF NOT EXISTS cost_basis_native NUMERIC;
ALTER TABLE proj_pnl_lots ADD COLUMN IF NOT EXISTS benchmark_asset_key TEXT;

-- ── proj_pnl_matches: native realized PnL ──────────────────────

ALTER TABLE proj_pnl_matches ADD COLUMN IF NOT EXISTS cost_basis_native NUMERIC;
ALTER TABLE proj_pnl_matches ADD COLUMN IF NOT EXISTS proceeds_native NUMERIC;
ALTER TABLE proj_pnl_matches ADD COLUMN IF NOT EXISTS realized_pnl_native NUMERIC;
ALTER TABLE proj_pnl_matches ADD COLUMN IF NOT EXISTS benchmark_asset_key TEXT;

-- ── proj_open_positions: prediction contracts + settlement ──────

ALTER TABLE proj_open_positions ADD COLUMN IF NOT EXISTS contracts NUMERIC;
ALTER TABLE proj_open_positions ADD COLUMN IF NOT EXISTS settlement_asset_key TEXT;
