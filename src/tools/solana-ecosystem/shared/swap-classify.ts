/**
 * Solana swap classification — deterministic tradeSide + instrumentMint.
 *
 * Uses canonical quote set (SOL + USDC + USDT) to classify swaps.
 * Pure function, no side effects.
 * Canonical source-of-truth: src/tools/solana-ecosystem/shared/swap-classify.ts
 */

import { SOL_MINT } from "./solana-constants.js";

const SOLANA_QUOTE_MINTS = new Set([
  SOL_MINT,                                              // SOL (native)
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",     // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",      // USDT
]);

const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",     // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",      // USDT
]);

export interface SwapClassification {
  tradeSide: "buy" | "sell" | null;
  instrumentMint: string;
  meta: { stableSwap?: true; ambiguousSwap?: true };
}

/**
 * Classify a Solana swap for portfolio tracking.
 *
 * Rules:
 * - stable → SOL: buy SOL
 * - SOL → stable: sell SOL
 * - stable → stable: currency conversion (null tradeSide, stableSwap hint)
 * - quote → non-quote: buy the non-quote asset
 * - non-quote → quote: sell the non-quote asset
 * - non-quote → non-quote: ambiguous (null tradeSide, ambiguousSwap hint)
 */
export function classifySolanaSwap(inputMint: string, outputMint: string): SwapClassification {
  const inputIsSol = inputMint === SOL_MINT;
  const outputIsSol = outputMint === SOL_MINT;
  const inputIsStable = STABLE_MINTS.has(inputMint);
  const outputIsStable = STABLE_MINTS.has(outputMint);
  const inputIsQuote = SOLANA_QUOTE_MINTS.has(inputMint);
  const outputIsQuote = SOLANA_QUOTE_MINTS.has(outputMint);

  // Explicit stable↔SOL (both are in quote set — must be checked first)
  if (inputIsStable && outputIsSol) {
    return { tradeSide: "buy", instrumentMint: SOL_MINT, meta: {} };
  }
  if (inputIsSol && outputIsStable) {
    return { tradeSide: "sell", instrumentMint: SOL_MINT, meta: {} };
  }

  // stable↔stable (USDC↔USDT): currency conversion, not inventory trade
  if (inputIsStable && outputIsStable) {
    return { tradeSide: null, instrumentMint: outputMint, meta: { stableSwap: true } };
  }

  // Standard: quote→non-quote (buy) / non-quote→quote (sell)
  if (inputIsQuote && !outputIsQuote) {
    return { tradeSide: "buy", instrumentMint: outputMint, meta: {} };
  }
  if (!inputIsQuote && outputIsQuote) {
    return { tradeSide: "sell", instrumentMint: inputMint, meta: {} };
  }

  // Both non-quote (meme↔meme): ambiguous direction
  return { tradeSide: null, instrumentMint: outputMint, meta: { ambiguousSwap: true } };
}
