/**
 * Quote plausibility guard — an ADDITIVE, advisory-only signal that a Uniswap
 * quote is almost certainly not executable as intended. It NEVER blocks a quote.
 *
 * Motivation (exit-guards Fix #1): a mission passed a RAW WEI value
 * (`48740243348995839475968`) as `amountIn` where human units (`48740.24`) were
 * expected. `parseUnits(raw, decimals)` scaled it by 10^decimals AGAIN, producing
 * a nonsense quote (~19.9 ETH out) that derailed the agent for ~30 min. Nothing
 * in the quote path questioned the result.
 *
 * The guard fires when EITHER of two independent signals trips:
 *   1. Extreme price impact (>= EXTREME_PRICE_IMPACT) — a near pool-drain; the
 *      most robust OUTPUT-side signal, available for V2-direct routes.
 *   2. A raw-wei heuristic on the INPUT string — a pure integer with enough
 *      significant digits that, read as human units, it is implausibly large and
 *      is far more likely a wei value mistakenly passed as human units. This is
 *      route-agnostic, so it catches the incident even on V3/multi-hop where no
 *      price impact is computed.
 *
 * Both signals are deliberately conservative to avoid false positives on valid
 * large trades — and because the field is advisory, a rare false positive costs
 * only an extra note, never a blocked trade.
 */

/** Price-impact fraction (1.0 = 100%) at/above which a quote is treated as extreme. */
export const EXTREME_PRICE_IMPACT = 0.95;

/**
 * Minimum significant-digit floor for the raw-wei heuristic, independent of
 * `decimals`. Protects low-decimal tokens (e.g. 6-dec USDC) where a legitimately
 * large amount (millions/billions) has far fewer digits than a wei value would.
 */
export const RAW_WEI_MIN_DIGITS = 15;

/**
 * Heuristic: does `amountInRaw` look like a raw wei value passed where human
 * units were expected? True only for a PURE non-negative integer string (no
 * decimal point, sign, or exponent) whose significant-digit count reaches
 * `max(tokenInDecimals, RAW_WEI_MIN_DIGITS)`. A genuine human amount essentially
 * never reaches 10^decimals whole tokens, whereas a wei value for an N-decimal
 * token carries ~N trailing digits by construction.
 */
export function looksLikeRawWei(amountInRaw: string, tokenInDecimals: number): boolean {
  const s = amountInRaw.trim();
  if (!/^\d+$/.test(s)) return false; // pure integer only — a "." / "-" / "e" is a human/other form
  const significant = s.replace(/^0+/, "").length; // ignore leading zeros
  const threshold = Math.max(tokenInDecimals, RAW_WEI_MIN_DIGITS);
  return significant >= threshold;
}

export interface QuotePlausibilityInput {
  /** The raw, human-supplied amount string exactly as passed to the quote. */
  readonly amountInRaw: string;
  /** Decimals of the input token (drives the raw-wei digit threshold). */
  readonly tokenInDecimals: number;
  /** Best-effort price impact fraction from the quote (V2-direct only); may be absent. */
  readonly priceImpact?: number | null;
}

/**
 * Return an advisory warning string when the quote is implausible, else `null`.
 * NEVER throws and NEVER blocks — the caller attaches the string as an optional
 * `warning` field on the quote response.
 */
export function isImplausibleQuote(input: QuotePlausibilityInput): string | null {
  const { amountInRaw, tokenInDecimals, priceImpact } = input;

  const extremeImpact =
    typeof priceImpact === "number" && Number.isFinite(priceImpact) && priceImpact >= EXTREME_PRICE_IMPACT;
  const rawWei = looksLikeRawWei(amountInRaw, tokenInDecimals);

  if (!extremeImpact && !rawWei) return null;

  const pct = extremeImpact ? ` (~${Math.round((priceImpact as number) * 100)}% price impact)` : "";
  return (
    `Implausible quote${pct}: extreme price impact / pool-draining — amountIn may be in the wrong units ` +
    `(raw wei vs human decimals) or exceed available liquidity; not executable as-is. ` +
    `Human units are expected (e.g. 48740.24, not 48740243348995839475968). ` +
    `Re-check the amount before executing.`
  );
}
