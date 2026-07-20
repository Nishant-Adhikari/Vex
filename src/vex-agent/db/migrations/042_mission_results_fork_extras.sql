-- Mission results ledger — fork extras layered on top of upstream's official
-- 041_mission_results.sql.
--
-- Upstream's 041 is the CANONICAL mission_results schema. This fork carries two
-- ledger features upstream's table does not model, re-applied here as additive
-- columns so the fork stays upstream-compatible (a future upstream change to
-- 041 merges cleanly; this file only ever ADDs):
--
--   1. Per-trade attribution counters (wins/losses/rotations/vetoes). The
--      headline PnL is bankroll-derived and needs no pairing, but the mission
--      ledger surfaces these counts in the history UI.
--   2. start_positions_json — the wallet's non-ETH holdings at run START.
--      open_positions_json captures bags held at CLOSE, but that includes
--      leftover dust from PRIOR missions, so a mission that ended flat still
--      showed "N bags". Recording the start holdings lets the read count only
--      NEW positions (end bags whose token address is absent at start), making
--      the held-bag count MISSION-ATTRIBUTABLE. Same JSONB array shape as
--      open_positions_json ({symbol,address,amount,valueUsd}).
--
-- IDEMPOTENT BY CONSTRUCTION (ADD COLUMN IF NOT EXISTS): the live dev database
-- was reconciled to upstream's 041 by hand and ALREADY carries these columns
-- from the fork's superseded 038/039. This migration must therefore be a no-op
-- there while still building the columns on a FRESH install.

ALTER TABLE mission_results
  ADD COLUMN IF NOT EXISTS wins       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotations  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vetoes     INTEGER NOT NULL DEFAULT 0;

ALTER TABLE mission_results
  ADD COLUMN IF NOT EXISTS start_positions_json JSONB;
