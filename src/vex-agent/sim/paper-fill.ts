/**
 * Paper-fill accounting — PURE math for the mission simulator.
 *
 * When a swap runs under a `simulator` mission run the broadcast is skipped and
 * the fill is SYNTHESIZED from the already-fetched live quote. The AMM quote
 * (`quoteBestRoute` / kyber route) already prices the fill against real pool
 * depth — its `amountOut` is the impact-aware expected execution — so the paper
 * fill takes the quoted `amountOut` verbatim and records the reported price
 * impact for transparency. No extra slippage is invented on top of a quote that
 * already models it.
 *
 * This module is DB-free and side-effect-free so the fill math + the
 * shadow-position bookkeeping are unit-testable without Postgres. The repo
 * (`db/repos/sim-ledger.ts`) persists what these functions compute.
 */

/** Normalized, protocol-agnostic description of a paper-filled swap leg. */
export interface SimSwapFill {
  /** Economic side (native-leg derived, not the tool name). */
  readonly side: "buy" | "sell";
  readonly chain: string;
  readonly dex: string;
  /** The NON-native traded token (acquired on a buy, disposed on a sell). */
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  /**
   * Human token quantity moved by this leg: acquired on a buy, sold on a sell.
   * Always >= 0.
   */
  readonly tokenQty: number;
  /**
   * Human native value moved: spent on a buy, received on a sell. `null` for a
   * token<->token leg with no native anchor (no native-denominated PnL then).
   */
  readonly nativeValue: number | null;
  readonly priceImpact: number | null;
}

/** A shadow position's mutable accounting state (native-denominated). */
export interface SimPositionState {
  /** Current held token quantity. */
  readonly qty: number;
  /** Native cost basis of the currently-held quantity. */
  readonly costNative: number;
  /** Cumulative realized paper PnL in native units. */
  readonly realizedPnlNative: number;
}

export const EMPTY_SIM_POSITION: SimPositionState = {
  qty: 0,
  costNative: 0,
  realizedPnlNative: 0,
};

/** Below this held quantity a position is considered fully closed (dust). */
const CLOSE_EPSILON = 1e-12;

export interface SimPositionUpdate {
  readonly next: SimPositionState;
  /** Realized paper PnL produced by THIS leg (0 for buys / no-anchor legs). */
  readonly realizedDelta: number;
  /** Whether the position is fully closed after this leg. */
  readonly closed: boolean;
}

/**
 * Apply one paper-filled leg to a shadow position.
 *
 * BUY  — increase qty by the acquired amount and add the native spent to the
 *        cost basis. No realized PnL.
 * SELL — reduce qty by the sold amount, remove the PROPORTIONAL cost basis, and
 *        realize `proceeds - costRemoved` in native. Selling more than held
 *        clamps to the held quantity (defensive; the agent trades what it owns).
 *
 * A leg with `nativeValue === null` (token<->token, no native anchor) still
 * moves quantity but contributes no native cost/PnL — the basis stays flat.
 */
export function applySimFill(
  prev: SimPositionState,
  fill: SimSwapFill,
): SimPositionUpdate {
  if (fill.side === "buy") {
    const next: SimPositionState = {
      qty: prev.qty + fill.tokenQty,
      costNative: prev.costNative + (fill.nativeValue ?? 0),
      realizedPnlNative: prev.realizedPnlNative,
    };
    return { next, realizedDelta: 0, closed: false };
  }

  // SELL — clamp the sold quantity to what is actually held.
  const soldQty = Math.min(fill.tokenQty, prev.qty);
  const proportion = prev.qty > 0 ? soldQty / prev.qty : 0;
  const costRemoved = prev.costNative * proportion;
  const proceeds = fill.nativeValue ?? 0;
  // No native anchor → no realized native PnL (cost basis unknown in native).
  const realizedDelta = fill.nativeValue === null ? 0 : proceeds - costRemoved;

  const nextQty = prev.qty - soldQty;
  const closed = nextQty <= CLOSE_EPSILON;
  const next: SimPositionState = {
    qty: closed ? 0 : nextQty,
    costNative: closed ? 0 : prev.costNative - costRemoved,
    realizedPnlNative: prev.realizedPnlNative + realizedDelta,
  };
  return { next, realizedDelta, closed };
}

/**
 * Mark-to-market value of an open shadow position in native units, given the
 * live per-token price (native per 1 token). Unrealized PnL is
 * `marketValue - costNative`.
 */
export function valueSimPosition(
  state: SimPositionState,
  nativePricePerToken: number,
): { readonly marketValueNative: number; readonly unrealizedPnlNative: number } {
  const marketValueNative = state.qty * nativePricePerToken;
  return {
    marketValueNative,
    unrealizedPnlNative: marketValueNative - state.costNative,
  };
}
