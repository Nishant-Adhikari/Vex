/**
 * Portfolio chain mapping — resolve instrument-key chain slugs to Khalani
 * chain IDs for joining spot lots against projected balances.
 */

import { CHAIN_ALIASES, getCachedKhalaniChains } from "@tools/khalani/chains.js";
import type { KhalaniChain } from "@tools/khalani/types.js";
import { resolveLocalChainId } from "@tools/evm-chains/registry.js";
import logger from "@utils/logger.js";

export type PortfolioChainIdMap = ReadonlyMap<string, number>;

function normalizeChainKey(value: string): string {
  return value.trim().toLowerCase();
}

function slugify(value: string): string {
  return normalizeChainKey(value).replace(/[^a-z0-9]+/g, "");
}

function resolveFromRegistry(chain: string, registry: readonly KhalaniChain[]): number | undefined {
  const normalized = normalizeChainKey(chain);
  const normalizedSlug = slugify(normalized);
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0) {
    const match = registry.find((entry) => entry.id === numeric);
    return match?.id;
  }

  const match = registry.find((entry) => {
    const nameSlug = slugify(entry.name);
    return nameSlug === normalizedSlug;
  });
  return match?.id;
}

function resolveFallback(chain: string): number | undefined {
  const normalized = normalizeChainKey(chain);
  const alias = CHAIN_ALIASES[normalized];
  if (alias !== undefined) return alias;

  // Local (non-Khalani) EVM registry — resolves aliases/name/id like "robinhood"
  // or "4663" without leaking those aliases into Khalani's own resolver.
  const localId = resolveLocalChainId(normalized);
  if (localId !== undefined) return localId;

  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

export async function resolvePortfolioChainIds(
  chains: readonly string[],
): Promise<PortfolioChainIdMap> {
  const uniqueChains = [...new Set(chains.map(normalizeChainKey).filter(Boolean))];
  const resolved = new Map<string, number>();
  if (uniqueChains.length === 0) return resolved;

  let registry: readonly KhalaniChain[] = [];
  try {
    registry = await getCachedKhalaniChains();
  } catch (err) {
    logger.warn("portfolio.chain_map.registry_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  for (const chain of uniqueChains) {
    const chainId = registry.length > 0
      ? resolveFromRegistry(chain, registry) ?? resolveFallback(chain)
      : resolveFallback(chain);
    if (chainId !== undefined) {
      resolved.set(chain, chainId);
    } else {
      logger.debug("portfolio.chain_map.unresolved", { chain });
    }
  }

  return resolved;
}

export function getPortfolioChainId(
  chainIds: PortfolioChainIdMap,
  chain: string,
): number | undefined {
  return chainIds.get(normalizeChainKey(chain));
}
