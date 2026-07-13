/**
 * Exit rules — pure, deterministic take-profit / stop-loss decision engine.
 *
 * Phase B of Vex's exit engine. Given an open position, the current price,
 * the current wall-clock (passed IN — never read here), and a static exit
 * config, `evaluateExit` returns the exit decisions that fire on this tick.
 *
 * Design constraints (enforced by tests):
 *   - PURE: no I/O, no Date.now(), no randomness. Same inputs → same output.
 *   - TOTAL: never throws. Non-finite / non-positive price or entry, or a
 *     malformed config, yields `[]` (documented "do nothing" rather than a
 *     crash) so a bad tick can never take down the watch worker (Phase C).
 *
 * Rule priority (capital preservation first):
 *   1. stop_loss     — decisive full exit of the remaining position.
 *   2. trailing_stop — full exit, but only once the ladder is in profit
 *                      (at least one TP rung consumed).
 *   3. take_profit   — partial exits per crossed ladder rung; multiple rungs
 *                      may fire on one tick; cumulative sold fraction is
 *                      clamped so it can never exceed the whole position.
 *   4. time_stop     — flat-and-dead rotation, only if nothing above fired.
 *
 * Fractions are always expressed relative to the ORIGINAL position size, so
 * the caller (Phase A cost-basis ledger) can mark rungs consumed and subtract
 * fractions without re-deriving token amounts.
 *
 * Backtest rationale: 62% of alpha calls tag 2x within 24h but holding
 * round-tripped the gains — so exits are deliberately decisive, not lenient.
 */

export interface Position {
  /** Token address or symbol — opaque id, never parsed here. */
  readonly token: string;
  /** Cost basis per token, USD, must be > 0. */
  readonly entryPriceUsd: number;
  /** Current holding size in tokens, must be > 0. */
  readonly amountTokens: number;
  /** Running high-water price seen since entry (>= entryPriceUsd). */
  readonly peakPriceUsd: number;
  /** Epoch ms when the position opened. */
  readonly openedAtMs: number;
  /** Indices of TP ladder rungs already sold — drives idempotency. */
  readonly consumedRungs: readonly number[];
}

export interface TakeProfitRung {
  /** Price multiple vs entry that arms this rung (e.g. 2 = +100%). */
  readonly multiple: number;
  /** Fraction (0..1) of the ORIGINAL position to sell at this rung. */
  readonly sellFraction: number;
}

export interface ExitConfig {
  /** Take-profit ladder, ascending by `multiple`. */
  readonly takeProfitLadder: readonly TakeProfitRung[];
  /** Fractional drawdown from entry that triggers a full stop (e.g. 0.35). */
  readonly stopLossPct: number;
  /**
   * Fractional drawdown from peak that trails out the remainder once the
   * ladder is in profit. Omitted / undefined disables trailing.
   */
  readonly trailingStopPct?: number;
  /** Minutes of flat-and-dead price action before a time-stop rotation. */
  readonly timeStopMinutes: number;
  /** Half-width of the "flat" band around entry (e.g. 0.15 = ±15%). */
  readonly timeStopFlatBandPct: number;
}

export type ExitReasonKind = "stop_loss" | "trailing_stop" | "take_profit" | "time_stop";

export interface ExitDecision {
  readonly kind: ExitReasonKind;
  /** Fraction of the ORIGINAL position to sell now, in (0..1]. */
  readonly sellFraction: number;
  /** Set for take_profit so the caller can mark the rung consumed. */
  readonly rungIndex?: number;
  /** Human-readable explanation, e.g. "Hit +100% take-profit rung (2x)". */
  readonly reason: string;
}

/** True for a real, strictly-positive number. */
function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * Fraction of the ORIGINAL position already sold, summed from the ladder
 * sellFractions at the consumed rung indices. Out-of-range / duplicate
 * indices are ignored so a malformed `consumedRungs` can't corrupt the math.
 */
function consumedFraction(position: Position, config: ExitConfig): number {
  const ladder = config.takeProfitLadder;
  const seen = new Set<number>();
  let total = 0;
  for (const idx of position.consumedRungs) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= ladder.length || seen.has(idx)) {
      continue;
    }
    seen.add(idx);
    const frac = ladder[idx].sellFraction;
    if (Number.isFinite(frac) && frac > 0) {
      total += frac;
    }
  }
  return total;
}

/** Remaining sellable fraction of the original position, clamped to [0, 1]. */
function remainingFraction(position: Position, config: ExitConfig): number {
  const remaining = 1 - consumedFraction(position, config);
  if (!Number.isFinite(remaining)) {
    return 0;
  }
  return Math.min(1, Math.max(0, remaining));
}

export function evaluateExit(
  position: Position,
  currentPriceUsd: number,
  nowMs: number,
  config: ExitConfig,
): ExitDecision[] {
  // --- Defensive totality: a bad tick must never throw or over-sell. ---
  if (!isPositiveFinite(currentPriceUsd) || !isPositiveFinite(position.entryPriceUsd)) {
    return [];
  }

  const { entryPriceUsd } = position;
  const remaining = remainingFraction(position, config);

  // Nothing left to sell → no exit is meaningful.
  if (remaining <= 0) {
    return [];
  }

  // --- 1. stop_loss (highest priority: capital preservation). ---
  if (Number.isFinite(config.stopLossPct)) {
    const stopPrice = entryPriceUsd * (1 - config.stopLossPct);
    if (currentPriceUsd <= stopPrice) {
      const lossPct = (1 - currentPriceUsd / entryPriceUsd) * 100;
      return [
        {
          kind: "stop_loss",
          sellFraction: remaining,
          reason: `Stop-loss hit: ${lossPct.toFixed(1)}% below entry (threshold ${(
            config.stopLossPct * 100
          ).toFixed(1)}%)`,
        },
      ];
    }
  }

  // --- 2. trailing_stop: only armed once at least one rung is consumed. ---
  if (
    position.consumedRungs.length > 0 &&
    config.trailingStopPct !== undefined &&
    Number.isFinite(config.trailingStopPct) &&
    isPositiveFinite(position.peakPriceUsd)
  ) {
    const trailPrice = position.peakPriceUsd * (1 - config.trailingStopPct);
    if (currentPriceUsd <= trailPrice) {
      const dropPct = (1 - currentPriceUsd / position.peakPriceUsd) * 100;
      return [
        {
          kind: "trailing_stop",
          sellFraction: remaining,
          reason: `Trailing stop hit: ${dropPct.toFixed(1)}% below peak (threshold ${(
            config.trailingStopPct * 100
          ).toFixed(1)}%)`,
        },
      ];
    }
  }

  // --- 3. take_profit: emit every newly-crossed rung, ascending, clamped. ---
  const takeProfits: ExitDecision[] = [];
  const consumed = new Set<number>(position.consumedRungs);
  let cumulative = consumedFraction(position, config); // fraction already sold

  config.takeProfitLadder.forEach((rung, index) => {
    if (consumed.has(index)) {
      return;
    }
    if (!Number.isFinite(rung.multiple) || !Number.isFinite(rung.sellFraction)) {
      return;
    }
    if (currentPriceUsd < entryPriceUsd * rung.multiple) {
      return;
    }
    const capacity = 1 - cumulative;
    if (capacity <= 0) {
      return; // fully allocated — nothing left to sell on this or later rungs.
    }
    const sellFraction = Math.min(rung.sellFraction, capacity);
    if (sellFraction <= 0) {
      return;
    }
    cumulative += sellFraction;
    const gainPct = (rung.multiple - 1) * 100;
    takeProfits.push({
      kind: "take_profit",
      sellFraction,
      rungIndex: index,
      reason: `Hit +${gainPct.toFixed(0)}% take-profit rung (${rung.multiple}x)`,
    });
  });

  if (takeProfits.length > 0) {
    return takeProfits;
  }

  // --- 4. time_stop: flat-and-dead rotation, only if nothing above fired. ---
  if (
    Number.isFinite(config.timeStopMinutes) &&
    Number.isFinite(config.timeStopFlatBandPct) &&
    Number.isFinite(nowMs) &&
    Number.isFinite(position.openedAtMs)
  ) {
    const elapsedMs = nowMs - position.openedAtMs;
    const bandDistance = Math.abs(currentPriceUsd / entryPriceUsd - 1);
    if (
      elapsedMs >= config.timeStopMinutes * 60_000 &&
      bandDistance <= config.timeStopFlatBandPct
    ) {
      const driftPct = (currentPriceUsd / entryPriceUsd - 1) * 100;
      return [
        {
          kind: "time_stop",
          sellFraction: remaining,
          reason: `Time-stop: flat ${driftPct.toFixed(
            1,
          )}% from entry after ${config.timeStopMinutes}m`,
        },
      ];
    }
  }

  return [];
}
