/**
 * Shared portfolio chain naming and default tracking set.
 *
 * Keeps snapshot collection, portfolio handlers, and trade capture aligned on
 * a single chain vocabulary.
 */

import { CHAIN_ALIASES } from "../khalani/chains.js";
import { getKyberChains, resolveChainSlug } from "../kyberswap/chains.js";

const CHAIN_ID_TO_NAME = new Map<number, string>();

for (const chain of getKyberChains()) {
  CHAIN_ID_TO_NAME.set(chain.chainId, chain.slug);
}

for (const [alias, chainId] of Object.entries(CHAIN_ALIASES)) {
  if (CHAIN_ID_TO_NAME.has(chainId)) continue;
  if (alias === "sol") continue;
  if (alias === "zerogravity") continue;
  CHAIN_ID_TO_NAME.set(chainId, alias);
}

export function resolvePortfolioChainName(chainId: number): string {
  return CHAIN_ID_TO_NAME.get(chainId) ?? `evm-${chainId}`;
}

export function normalizePortfolioChain(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return input;

  if (normalized === "sol" || normalized === "solana") return "solana";
  if (normalized === "0g" || normalized === "zerogravity") return "0g";

  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0) {
    return resolvePortfolioChainName(numeric);
  }

  try {
    return resolveChainSlug(normalized);
  } catch {
    // Fall through to Khalani aliases or original input.
  }

  if (normalized in CHAIN_ALIASES) {
    return resolvePortfolioChainName(CHAIN_ALIASES[normalized]);
  }

  return normalized;
}

export function getDefaultTrackedChains(): string[] {
  return [...new Set(["0g", "solana", ...getKyberChains().map((chain) => chain.slug)])];
}
