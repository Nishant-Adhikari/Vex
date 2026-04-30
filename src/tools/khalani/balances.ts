import { VexError, ErrorCodes } from "../../errors.js";
import { getKhalaniClient } from "./client.js";
import { getCachedKhalaniChains, resolveChainId } from "./chains.js";
import type { ChainFamily, KhalaniChain, KhalaniToken } from "./types.js";

const DEFAULT_BALANCE_SCAN_CONCURRENCY = 4;

export interface BalanceChainError {
  chainId: number;
  chainName?: string;
  message: string;
}

export interface BalanceChainSelection {
  rawProvided: boolean;
  byFamily: ReadonlyMap<ChainFamily, readonly number[]>;
}

export interface TokenBalanceScanResult {
  address: string;
  family: ChainFamily;
  tokens: KhalaniToken[];
  scannedChainIds: number[];
  chainErrors: BalanceChainError[];
  totalUsd: number;
}

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
      throw new VexError(
        ErrorCodes.KHALANI_UNSUPPORTED_CHAIN,
        `Chain ${chainId} is not in the current Khalani registry.`,
        "Refresh chains and retry.",
      );
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

export async function getTokenBalancesAcrossChains(input: {
  address: string;
  family: ChainFamily;
  chainIds?: readonly number[];
  concurrency?: number;
}): Promise<TokenBalanceScanResult> {
  const chains = await getCachedKhalaniChains();
  const targetChains = resolveTargetChains(chains, input.family, input.chainIds);
  if (targetChains.length === 0) {
    return {
      address: input.address,
      family: input.family,
      tokens: [],
      scannedChainIds: [],
      chainErrors: [],
      totalUsd: 0,
    };
  }

  const concurrency = input.concurrency ?? DEFAULT_BALANCE_SCAN_CONCURRENCY;
  const client = getKhalaniClient();
  const tokens: KhalaniToken[] = [];
  const scannedChainIds: number[] = [];
  const chainErrors: BalanceChainError[] = [];

  await mapWithConcurrency(targetChains, concurrency, async (chain) => {
    try {
      const chainTokens = await client.getTokenBalances(input.address, [chain.id]);
      tokens.push(...chainTokens);
      scannedChainIds.push(chain.id);
    } catch (err) {
      chainErrors.push({
        chainId: chain.id,
        chainName: chain.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  if (scannedChainIds.length === 0 && chainErrors.length > 0) {
    throw new VexError(
      ErrorCodes.KHALANI_API_ERROR,
      `Khalani balance scan failed for every ${input.family} chain.`,
      chainErrors.map((entry) => `${entry.chainName ?? entry.chainId}: ${entry.message}`).join("; "),
    );
  }

  const sortedTokens = [...tokens].sort((left, right) => tokenUsd(right) - tokenUsd(left));
  return {
    address: input.address,
    family: input.family,
    tokens: sortedTokens,
    scannedChainIds: scannedChainIds.sort((left, right) => left - right),
    chainErrors: chainErrors.sort((left, right) => left.chainId - right.chainId),
    totalUsd: calculateTokensTotalUsd(sortedTokens),
  };
}

function resolveTargetChains(
  chains: readonly KhalaniChain[],
  family: ChainFamily,
  chainIds: readonly number[] | undefined,
): KhalaniChain[] {
  if (!chainIds) {
    return chains.filter((chain) => chain.type === family);
  }

  const result: KhalaniChain[] = [];
  for (const chainId of chainIds) {
    const chain = chains.find((entry) => entry.id === chainId);
    if (!chain) {
      throw new VexError(
        ErrorCodes.KHALANI_UNSUPPORTED_CHAIN,
        `Chain ${chainId} is not in the current Khalani registry.`,
        "Refresh chains and retry.",
      );
    }
    if (chain.type !== family) {
      throw new VexError(
        ErrorCodes.KHALANI_UNSUPPORTED_CHAIN,
        `Chain ${chain.name} (${chain.id}) is ${chain.type}, but this balance scan is for ${family}.`,
      );
    }
    result.push(chain);
  }

  return result;
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const value = values[currentIndex];
      if (value !== undefined) {
        await worker(value);
      }
    }
  });

  await Promise.all(workers);
}

export function calculateTokensTotalUsd(tokens: readonly KhalaniToken[]): number {
  return tokens.reduce((sum, token) => sum + tokenUsd(token), 0);
}

function tokenUsd(token: KhalaniToken): number {
  const balanceRaw = token.extensions?.balance;
  const priceUsd = token.extensions?.price?.usd;
  if (!balanceRaw || !priceUsd) return 0;

  try {
    const balanceHuman = Number(BigInt(balanceRaw)) / Math.pow(10, token.decimals);
    const price = Number(priceUsd);
    if (!Number.isFinite(balanceHuman) || !Number.isFinite(price)) return 0;
    return balanceHuman * price;
  } catch {
    return 0;
  }
}
