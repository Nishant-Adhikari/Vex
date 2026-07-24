/**
 * Pure derivations for the sidebar POSITION summary (the widget that replaced
 * the $VEX price card). Kept React/IPC-free so the token-matching math is
 * unit-tested in isolation.
 */

/** The subset of a portfolio token row this summary reads. */
export interface SummaryToken {
  readonly symbol: string | null;
  readonly amount: number | null;
}

/**
 * Sum the human token quantity across every holding whose symbol matches
 * `symbol` (case-insensitive) — e.g. the native ETH balance aggregated across
 * chains. Rows with an unknown amount (`null`/non-finite) contribute nothing.
 * Returns `null` when NO matching priced-quantity row exists, so the caller can
 * omit the line rather than render a fabricated `0`.
 */
export function sumTokenAmountBySymbol(
  tokens: readonly SummaryToken[],
  symbol: string,
): number | null {
  const target = symbol.trim().toLowerCase();
  let total = 0;
  let matched = false;
  for (const t of tokens) {
    if (t.symbol === null) continue;
    if (t.symbol.trim().toLowerCase() !== target) continue;
    if (t.amount === null || !Number.isFinite(t.amount)) continue;
    total += t.amount;
    matched = true;
  }
  return matched ? total : null;
}
