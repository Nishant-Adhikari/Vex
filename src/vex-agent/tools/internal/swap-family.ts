/**
 * Swap family classifier — shared between the Stage 8a READ-ONLY `swap_quote`
 * alias and the Stage 8b MUTATING `swap` alias router.
 *
 * One classifier, one source of truth: both aliases route by `chain` to either
 * the EVM (KyberSwap) or Solana (Jupiter) family. Extracted here so the
 * mutating router cannot drift from the read-only quote router (e.g. accept a
 * chain for execute that the quote rejected, or vice versa) — they MUST agree
 * on which family a chain maps to or the Stage-7 prequote gate's match-hash
 * would never collide between the quote and the execute.
 *
 * Pure helper: only `resolveChainSlug` (local, no network) is consulted. No
 * wallet, DB, or privileged imports.
 */

import { resolveChainSlug } from "@tools/kyberswap/chains.js";

/** Chain values that route to the Solana (Jupiter) family. Checked before EVM. */
export const SOLANA_CHAIN_VALUES: ReadonlySet<string> = new Set(["solana", "sol"]);

export type SwapFamily =
  | { readonly kind: "evm"; readonly chainSlug: string }
  | { readonly kind: "solana" }
  | { readonly kind: "unknown" };

/**
 * Decide the swap family from a `chain` arg. Solana is matched explicitly FIRST
 * (its slug is not a `KyberChainSlug`); EVM is confirmed by `resolveChainSlug`
 * (throws on unknown). Anything neither Solana nor a known EVM chain is
 * `unknown` → callers fail clearly instead of guessing.
 */
export function classifySwapFamily(chain: string): SwapFamily {
  const normalized = chain.toLowerCase().trim();
  if (SOLANA_CHAIN_VALUES.has(normalized)) return { kind: "solana" };
  try {
    return { kind: "evm", chainSlug: resolveChainSlug(normalized) };
  } catch {
    return { kind: "unknown" };
  }
}
