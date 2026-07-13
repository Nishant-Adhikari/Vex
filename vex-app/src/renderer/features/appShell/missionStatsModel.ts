/**
 * Mission STATS aggregation — the seed-reuse-safe, capital-weighted rollups the
 * Dashboard "Mission performance" / "Mission stats" panel renders.
 *
 * WHY a dedicated module: the panel previously summed every mission's seed and
 * divided cumulative PnL by the OLDEST (tiniest) mission's seed. On a real
 * 4-mission run that redeployed the same ~0.11 ETH across missions 3 & 4 that
 * produced a bogus **-32.77%** headline and a double-counted **"Seed"** — the
 * same capital counted four times. Each mission is self-contained: its PnL is
 * its own `end − start`. So:
 *
 *   • cumulative PnL      = Σ pnl_eth                      (plain native sum)
 *   • return %            = Σ pnl_eth / Σ seed_eth         (CAPITAL-weighted)
 *   • current stake       = the LATEST mission's seed      (deployed capital now)
 *
 * ETH is the source of truth — every figure here is native ETH; USD is derived
 * for DISPLAY ONLY in the panel, per-mission at each mission's own price (a
 * single ETH price is never divided across missions).
 *
 * Cumulative / win-rate / best-worst are ALREADY-TESTED primitives in
 * `missionHistoryModel.ts`; this module re-exports them under the panel's
 * vocabulary rather than re-deriving (single source of truth). Only the two
 * genuinely new derivations — capital-weighted return and current stake — live
 * here. Pure: no I/O, no clock.
 */

import type { MissionResultDto } from "@shared/schemas/mission.js";
import { bestWorst, computeWinRate, sumPnlEth } from "./missionHistoryModel.js";

/** Cumulative realized ETH PnL — Σ of every computable `pnlEth` (nulls skip). */
export const cumulativeMissionPnlEth = sumPnlEth;

/** Share of missions with `pnlEth > 0` (0–100), null-pnl rows off the denominator. */
export const winRate = computeWinRate;

/** Best (max) and worst (min) single-mission ETH pnl; `null` when none computable. */
export const bestWorstEth = bestWorst;

/**
 * Capital-weighted return: `Σ pnl_eth / Σ seed_eth`, as a percentage.
 *
 * The denominator is the SUM of the per-mission starting bankrolls — capital
 * weighting, so a large mission moves the number more than a tiny one — NOT the
 * single oldest seed (the -32.77% bug). A mission contributes to BOTH sides
 * only when it carries a finite pnl AND a finite starting bankroll, so a
 * snapshot-less row can't skew the ratio. `null` when nothing qualifies or the
 * summed seed is 0 (no meaningful denominator).
 *
 * NOTE: this weights by Σ seed even when the same capital was reused across
 * missions (missions 3 & 4). That is intentional — it is a return *on capital
 * put to work per mission*, not on peak capital at risk. It is never a single
 * seed in the denominator.
 */
export function capitalWeightedReturn(
  results: readonly MissionResultDto[],
): number | null {
  let pnlSum = 0;
  let seedSum = 0;
  let qualified = false;
  for (const r of results) {
    if (r.pnlEth === null || !Number.isFinite(r.pnlEth)) continue;
    const seed = r.bankrollStartEth;
    if (seed === null || seed === undefined || !Number.isFinite(seed)) continue;
    pnlSum += r.pnlEth;
    seedSum += seed;
    qualified = true;
  }
  if (!qualified || seedSum === 0) return null;
  return (pnlSum / seedSum) * 100;
}

/**
 * Current stake — the LATEST mission's starting bankroll, i.e. the capital
 * currently deployed. Input is newest-first (as `mission.listResults` returns
 * it), so scan from the front for the first finite `bankrollStartEth`; a newest
 * row missing its snapshot is skipped for the next newest. `null` when no
 * mission carries a bankroll snapshot.
 *
 * This REPLACES the old "Seed" figure, which summed all mission seeds and so
 * double-counted the ~0.11 ETH reused across missions 3 & 4.
 */
export function currentStakeEth(
  results: readonly MissionResultDto[],
): number | null {
  for (const r of results) {
    const seed = r.bankrollStartEth;
    if (seed !== null && seed !== undefined && Number.isFinite(seed)) return seed;
  }
  return null;
}
