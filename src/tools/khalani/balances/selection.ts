/**
 * Khalani balance chain-selection parsing.
 *
 * Moved VERBATIM from the original `balances.ts` god-file. The inline
 * "chain not in registry" throw is single-sourced as `chainNotInRegistryError`
 * in `./_shared.js` (shared with the scan target resolver) — the thrown
 * `VexError(KHALANI_UNSUPPORTED_CHAIN, …)` is identical.
 */

import { getCachedKhalaniChains, resolveChainId } from "../chains.js";
import type { ChainFamily } from "../types.js";
import { chainNotInRegistryError } from "./_shared.js";
import type { BalanceChainSelection } from "./types.js";

export async function parseBalanceChainSelection(
  raw: string | undefined,
): Promise<BalanceChainSelection> {
  if (!raw) {
    return { rawProvided: false, byFamily: new Map() };
  }

  const chains = await getCachedKhalaniChains();
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { rawProvided: false, byFamily: new Map() };
  }

  const byFamily = new Map<ChainFamily, number[]>();
  for (const part of parts) {
    const chainId = resolveChainId(part, chains);
    const chain = chains.find((entry) => entry.id === chainId);
    if (!chain) {
      throw chainNotInRegistryError(chainId);
    }
    const existing = byFamily.get(chain.type) ?? [];
    if (!existing.includes(chainId)) existing.push(chainId);
    byFamily.set(chain.type, existing);
  }

  return { rawProvided: true, byFamily };
}

export function getSelectedChainIdsForFamily(
  selection: BalanceChainSelection,
  family: ChainFamily,
): readonly number[] | undefined {
  if (!selection.rawProvided) return undefined;
  return selection.byFamily.get(family) ?? [];
}
