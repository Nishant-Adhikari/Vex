-- Puzzle 5 phase 5E-1 — per-wallet portfolio snapshots + position identity fix.
--
-- Multi-wallet correctness: the background balance sync now projects EVERY
-- inventory wallet (≤3 EVM + ≤3 Solana), not just the global primary. Each
-- sync cycle writes one snapshot row PER wallet, tagged with a shared
-- snapshot_group_id so an aggregate portfolio view can stitch a single cycle
-- back together even though per-wallet rows have distinct created_at.
--
-- proj_balances + proj_open_positions were already keyed by wallet_address;
-- only the snapshot table lacked a wallet dimension, and the open-positions
-- uniqueness key omitted wallet (+chain) — letting two wallets that hold a
-- position with the same external_id silently overwrite each other.
--
-- Idempotent (matches 026 style): IF NOT EXISTS columns/indexes + a pg_constraint
-- guard for the CHECK, so a partial re-run is safe. Columns are NOT NULL — every
-- snapshot now describes exactly one wallet and the DB has never been run in
-- this dev line, so the table is empty and no backfill is required.

-- ── proj_portfolio_snapshots: add wallet dimension + cycle group ────────────
ALTER TABLE proj_portfolio_snapshots ADD COLUMN IF NOT EXISTS wallet_family TEXT NOT NULL;
ALTER TABLE proj_portfolio_snapshots ADD COLUMN IF NOT EXISTS wallet_address TEXT NOT NULL;
ALTER TABLE proj_portfolio_snapshots ADD COLUMN IF NOT EXISTS snapshot_group_id UUID NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proj_portfolio_snapshots_wallet_family_check'
  ) THEN
    ALTER TABLE proj_portfolio_snapshots
      ADD CONSTRAINT proj_portfolio_snapshots_wallet_family_check
      CHECK (wallet_family IN ('eip155', 'solana'));
  END IF;
END $$;

-- "latest snapshot for this wallet" (PnL baseline + per-wallet read filter).
CREATE INDEX IF NOT EXISTS idx_portfolio_wallet_time
  ON proj_portfolio_snapshots(wallet_family, wallet_address, created_at DESC);

-- "all wallet rows from one full-sync cycle" (aggregate portfolio view).
CREATE INDEX IF NOT EXISTS idx_portfolio_group
  ON proj_portfolio_snapshots(snapshot_group_id);

-- ── proj_open_positions: identity must include chain + wallet ───────────────
-- external_id is NOT proven globally unique per (namespace, position_type)
-- across chains, so chain stays in the key alongside wallet_address.
DROP INDEX IF EXISTS idx_positions_external;
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_external
  ON proj_open_positions(namespace, position_type, chain, wallet_address, external_id)
  WHERE external_id IS NOT NULL;
