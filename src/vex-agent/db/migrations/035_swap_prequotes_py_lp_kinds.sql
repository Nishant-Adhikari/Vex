-- P4/P5 (Pendle PY mint/redeem + LP) — expand swap_prequotes.kind for the new
-- Pendle prequote kinds.
--
-- Migration 034 widened `kind` to ('swap', 'bridge', 'redeem'). Pendle's PY
-- surface adds identities that are NEITHER a swap, a bridge, nor a matured-PT
-- redeem: a mint (token → PT+YT) and a PRE-EXPIRY py-redeem (PT+YT → token) each
-- carry their own dedicated identity + material (see
-- prequote/identity/pendle-py.ts) and their own record/gate branches, so they
-- must never reuse the swap/bridge/redeem kind. The pre-expiry py-redeem gets its
-- OWN kind `redeem_py` (with its own outputToken-bearing material) rather than
-- overloading the matured `redeem` material.
--
-- This EXPAND-ONLY migration widens the CHECK to include the four new kinds:
--   - 'mint'      : Pendle py.mint (token → PT+YT),
--   - 'redeem_py' : Pendle py.redeem (pre-expiry PT+YT → token),
--   - 'lp_add'    : Pendle lp.add (P5 — lands now so P5 needs no second migration),
--   - 'lp_remove' : Pendle lp.remove (P5).
-- No rows change and no column is dropped.
--
-- Forward-only, idempotent: drop the old constraint if present, then add the
-- widened one only when it is not already there. The mirror under vex-app is kept
-- in sync by scripts/copy-migrations.mjs.

ALTER TABLE swap_prequotes
  DROP CONSTRAINT IF EXISTS swap_prequotes_kind_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swap_prequotes_kind_check'
  ) THEN
    ALTER TABLE swap_prequotes
      ADD CONSTRAINT swap_prequotes_kind_check
      CHECK (kind IN ('swap', 'bridge', 'redeem', 'mint', 'redeem_py', 'lp_add', 'lp_remove'));
  END IF;
END$$;
