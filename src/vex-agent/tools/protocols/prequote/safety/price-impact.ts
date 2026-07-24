/**
 * Pre-buy price-impact / liquidity guard for EVM swap quotes.
 *
 * The single biggest realized-loss driver on a swap is buying size INTO a thin
 * pool and bleeding ~25% to price impact + slippage (mission #22 lost -26% this
 * exact way). The prequote gate already BLOCKS the execute on a `fail` verdict
 * (and on a missing/stale prequote); `pass` and `unknown` both PASS the gate
 * (unknown = allowed-with-approval-warning). So this leg's job is to turn a
 * catastrophic-impact quote into a hard `fail` (blocked), a merely-risky quote
 * into a disclosed `unknown` (warned), and leave a healthy quote a `pass`.
 *
 * Verdict map (mirrors the Pendle price-impact leg's shape in `extract.ts`):
 *   - |impact| ≥ HARD ceiling (default 15%)                → fail  (the #22 case)
 *   - trade USD ≥ MAX fraction of pool liquidity (def 25%) → fail  (thin pool)
 *   - WARN ≤ |impact| < HARD (default 5%)                  → unknown (disclosed)
 *   - impact < WARN AND (liquidity unknown or small trade) → pass
 *   - missing/unparseable impact                           → unknown (fail-closed;
 *                                                             NEVER a silent pass)
 *
 * Sign convention: price impact is the fractional value LOST between the input
 * and output legs (0.0015 = 0.15%). A NEGATIVE value means the quote is
 * favorable (more out than in) and is clamped to 0 — a favorable trade is never
 * blocked. This matches both the KyberSwap `routeSummary.priceImpact` derivation
 * (`1 - amountOutUsd/amountInUsd`) and the Uniswap V2 impact (already clamped ≥0).
 *
 * The trade-size-vs-liquidity leg is an ADDITIONAL fail condition that is
 * FAIL-OPEN on missing data: when either the trade USD size or the pool
 * liquidity USD is unknown, the leg simply does not apply (it never forces an
 * `unknown`). Only the price-impact leg is fail-closed on missing data — that is
 * the guaranteed, always-disclosed signal.
 *
 * Thresholds are env-configurable with fail-open parsing (a bad value can never
 * block a run — it silently falls back to the default), mirroring the
 * `resolveMissionTokenBudget` stance in `src/lib/agent-config.ts`:
 *   AGENT_SWAP_MAX_PRICE_IMPACT_BPS       default 1500 (15%) — hard block
 *   AGENT_SWAP_WARN_PRICE_IMPACT_BPS      default  500 ( 5%) — warn
 *   AGENT_SWAP_MAX_LIQUIDITY_FRACTION_BPS default 2500 (25%) — hard block
 */

export type ImpactLegVerdict = "pass" | "fail" | "unknown";

/** Resolved fractional thresholds (bps ÷ 10_000). */
export interface PriceImpactThresholds {
  /** Hard-block ceiling on |price impact| (fraction). Default 0.15. */
  readonly maxImpact: number;
  /** Warn threshold on |price impact| (fraction). Default 0.05. */
  readonly warnImpact: number;
  /** Hard-block ceiling on tradeUsd / liquidityUsd (fraction). Default 0.25. */
  readonly maxLiquidityFraction: number;
}

const DEFAULT_MAX_IMPACT_BPS = 1500; // 15%
const DEFAULT_WARN_IMPACT_BPS = 500; // 5%
const DEFAULT_MAX_LIQUIDITY_FRACTION_BPS = 2500; // 25%

const BPS_PER_UNIT = 10_000;

/**
 * Parse a whole-number basis-points env value into a fraction, FAIL-OPEN.
 *
 * Unset, blank, non-integer, negative, or out-of-range (> 10_000 bps = > 100%)
 * all resolve to the default — a mis-set env must never block a legitimate swap.
 * The upper bound is 10_000 bps (100%): an impact/fraction threshold above 100%
 * is nonsensical and is treated as a typo → default.
 */
function parseBpsFractionOrDefault(
  raw: string | null | undefined,
  defaultBps: number,
): number {
  if (raw == null) return defaultBps / BPS_PER_UNIT;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return defaultBps / BPS_PER_UNIT;
  if (!/^\d+$/.test(trimmed)) return defaultBps / BPS_PER_UNIT; // non-integer / signed → default
  const bps = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(bps) || bps < 0 || bps > BPS_PER_UNIT) return defaultBps / BPS_PER_UNIT;
  return bps / BPS_PER_UNIT;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the effective fractional thresholds from env (fail-open per field).
 * Injectable for tests; defaults to `process.env`.
 */
export function resolvePriceImpactThresholds(env: EnvLike = process.env): PriceImpactThresholds {
  return {
    maxImpact: parseBpsFractionOrDefault(env.AGENT_SWAP_MAX_PRICE_IMPACT_BPS, DEFAULT_MAX_IMPACT_BPS),
    warnImpact: parseBpsFractionOrDefault(env.AGENT_SWAP_WARN_PRICE_IMPACT_BPS, DEFAULT_WARN_IMPACT_BPS),
    maxLiquidityFraction: parseBpsFractionOrDefault(
      env.AGENT_SWAP_MAX_LIQUIDITY_FRACTION_BPS,
      DEFAULT_MAX_LIQUIDITY_FRACTION_BPS,
    ),
  };
}

export interface PriceImpactGuardInput {
  /**
   * Fractional price impact from the quote (0.0015 = 0.15%). `null`/`undefined`
   * or non-finite → the impact leg is `unknown` (fail-closed disclosure). A
   * negative value (favorable) is clamped to 0.
   */
  readonly priceImpact: number | null | undefined;
  /** USD size of the trade (input leg), when the provider surfaces it. */
  readonly amountInUsd?: number | null;
  /** USD liquidity of the pool the trade routes through, when surfaced. */
  readonly liquidityUsd?: number | null;
  /** Override the env-resolved thresholds (tests). */
  readonly thresholds?: PriceImpactThresholds;
}

export interface PriceImpactGuardResult {
  readonly verdict: ImpactLegVerdict;
  /** Bounded, structural-only disclosure to merge into the quote's safetyDetail. */
  readonly detail: Record<string, unknown>;
}

/** Worst-leg aggregation: any fail → fail; else any unknown → unknown; else pass. */
function aggregate(legs: readonly ImpactLegVerdict[]): ImpactLegVerdict {
  if (legs.includes("fail")) return "fail";
  if (legs.includes("unknown")) return "unknown";
  return "pass";
}

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Evaluate the price-impact + liquidity-fraction guard for one swap quote.
 *
 * Returns a single aggregated leg verdict plus a bounded `safetyDetail`
 * fragment (`{ priceImpact: { checked, magnitude, high } }`, and — only when
 * both USD figures are known — `{ liquidityImpact: { checked, fraction, high } }`).
 * Pure: no IO, never throws.
 */
export function evaluatePriceImpactGuard(input: PriceImpactGuardInput): PriceImpactGuardResult {
  const thresholds = input.thresholds ?? resolvePriceImpactThresholds();
  const legs: ImpactLegVerdict[] = [];
  const detail: Record<string, unknown> = {};

  // ── Price-impact leg (fail-closed on missing data) ──────────────────────
  const impact = finiteOrNull(input.priceImpact);
  if (impact === null) {
    legs.push("unknown");
    detail.priceImpact = { checked: false };
  } else {
    const magnitude = impact > 0 ? impact : 0; // favorable (negative) → 0, never a concern
    let verdict: ImpactLegVerdict;
    if (magnitude >= thresholds.maxImpact) {
      verdict = "fail"; // the #22 disaster — MUST NOT execute
    } else if (magnitude >= thresholds.warnImpact) {
      verdict = "unknown"; // risky — allowed-with-approval-warning, disclosed
    } else {
      verdict = "pass";
    }
    legs.push(verdict);
    detail.priceImpact = { checked: true, magnitude, high: magnitude >= thresholds.warnImpact };
  }

  // ── Trade-size-vs-liquidity leg (fail-OPEN on missing data) ─────────────
  const tradeUsd = finiteOrNull(input.amountInUsd);
  const liquidityUsd = finiteOrNull(input.liquidityUsd);
  if (tradeUsd !== null && tradeUsd > 0 && liquidityUsd !== null && liquidityUsd > 0) {
    const fraction = tradeUsd / liquidityUsd;
    const high = fraction >= thresholds.maxLiquidityFraction;
    legs.push(high ? "fail" : "pass");
    detail.liquidityImpact = { checked: true, fraction, high };
  }
  // else: unknown trade size and/or liquidity → the leg does not apply (the
  // price-impact leg already governs); no `liquidityImpact` key is emitted.

  return { verdict: aggregate(legs), detail };
}
