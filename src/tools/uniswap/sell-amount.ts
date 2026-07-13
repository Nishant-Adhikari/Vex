/**
 * Sell-live-balance resolver — a backward-compatible way to sell the EXACT live
 * on-chain balance, killing the drift/re-quote churn on exits.
 *
 * Motivation (exit-guards Fix #2): an exit computes `amountIn` from the entry
 * figure, but held balances DRIFT (settlement rounding, fee-on-transfer), so the
 * amount frequently exceeds the live balance by dust → `ensureUniswapSufficient
 * Balance` rejects it → the agent re-quotes a slightly smaller number → repeat,
 * burning gas. The sentinel `amountIn: "max"` (or a `sellFraction`) resolves the
 * amount against the wallet's live balance at quote/execute time.
 *
 * A NORMAL numeric `amountIn` is parsed exactly as before — this module changes
 * nothing on the happy path.
 */

import { parseUnits } from "viem";

import { VexError, ErrorCodes } from "../../errors.js";

/** Sentinel value for `amountIn` meaning "sell the entire live on-chain balance". */
export const SELL_MAX_SENTINEL = "max";

/** Fixed-point scale for fractional math on bigint balances (6 dp of fraction precision). */
const FRACTION_SCALE = 1_000_000n;

/** True when `amountInRaw` is the max sentinel (case-insensitive, trimmed). */
export function isMaxSellSentinel(amountInRaw: string): boolean {
  return amountInRaw.trim().toLowerCase() === SELL_MAX_SENTINEL;
}

export interface ResolveSellAmountArgs {
  /** Raw amount string as supplied — a numeric string or the "max" sentinel. */
  readonly amountInRaw: string;
  /** Decimals of the input token (for parsing a numeric amount). */
  readonly tokenInDecimals: number;
  /** The wallet's live on-chain balance of the input token (raw base units). */
  readonly liveBalance: bigint;
  /** Optional fraction (0, 1] of the live balance to sell — overrides amountIn. */
  readonly sellFraction?: number | null;
}

/**
 * Resolve the base-unit sell amount.
 *
 * Precedence:
 *   1. `sellFraction` (when provided) → `floor(liveBalance * fraction)`, capped
 *      at the live balance. Overrides `amountIn`.
 *   2. `amountIn === "max"` → the EXACT live balance.
 *   3. otherwise → `parseUnits(amountInRaw, tokenInDecimals)` (unchanged).
 *
 * The live-balance paths NEVER exceed `liveBalance`. A numeric amount is returned
 * as-is (NOT clamped) so the existing balance guard keeps ownership of the
 * over-balance decision and its clear error message.
 */
export function resolveSellAmount(args: ResolveSellAmountArgs): bigint {
  const { amountInRaw, tokenInDecimals, liveBalance, sellFraction } = args;

  if (sellFraction !== undefined && sellFraction !== null) {
    if (!Number.isFinite(sellFraction) || sellFraction <= 0 || sellFraction > 1) {
      throw new VexError(
        ErrorCodes.INVALID_AMOUNT,
        `sellFraction must be a number in (0, 1]; got ${String(sellFraction)}.`,
        "Pass e.g. 0.5 to sell half of the live balance, or omit it (with amountIn \"max\") to sell all.",
      );
    }
    const scaled = BigInt(Math.round(sellFraction * Number(FRACTION_SCALE)));
    const amount = (liveBalance * scaled) / FRACTION_SCALE;
    return amount > liveBalance ? liveBalance : amount;
  }

  if (isMaxSellSentinel(amountInRaw)) {
    return liveBalance;
  }

  return parseUnits(amountInRaw, tokenInDecimals);
}

/** True when the request uses the live-balance path (sentinel or fraction). */
export function usesLiveBalanceSell(amountInRaw: string, sellFraction?: number | null): boolean {
  return isMaxSellSentinel(amountInRaw) || (sellFraction !== undefined && sellFraction !== null);
}
