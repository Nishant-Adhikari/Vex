/**
 * Direct-RPC balance sync for local (non-Khalani) EVM chains.
 *
 * Khalani provides balances for the chains it covers (see
 * `sync/balance-sync.ts` → `getTokenBalancesAcrossChains`). Chains in the LOCAL
 * registry (`tools/evm-chains/registry.ts`, e.g. Robinhood Chain 4663) are read
 * straight from RPC here and written through the SAME transactional per-chain
 * replace (`balancesRepo.replaceBalancesForChain`), so the projection layer,
 * snapshots, and `active_chains` treat them identically to Khalani chains.
 *
 * Token set = the chain's seed set ∪ the wallet's tracked tokens (distinct hex
 * addresses from successful spot `proj_activity` rows — LOCKED correction #1).
 * Reads batch through the canonical Multicall3; USD prices come from DexScreener
 * (the same throttled client the market tools use). A token without a DexScreener
 * price keeps its balance with a null USD value — it is never dropped.
 *
 * Failure semantics (Codex final-review fix): fail-soft (return skipped, keep
 * the last-good rows) applies ONLY to on-chain/RPC/transport failures —
 * multicall reads, RPC connect, DexScreener pricing. DB failures — the
 * tracked-token read (`getTrackedEvmTokensForChain`) and the transactional
 * write (`replaceBalancesForChain`) — PROPAGATE so the sync run fails visibly
 * and retries per existing worker semantics, exactly like DB errors on the
 * Khalani sync path.
 */

import { formatUnits, getAddress, type Chain, type PublicClient, type Transport } from "viem";

import { getDexScreenerClient } from "@tools/dexscreener/client.js";
import { NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { getLocalChain, type LocalChainConfig } from "@tools/evm-chains/registry.js";
import { getLocalPublicClient } from "@tools/evm-chains/evm-client.js";
import type { ChainFamily } from "@tools/khalani/types.js";
import * as activityRepo from "@vex-agent/db/repos/activity.js";
import * as balancesRepo from "@vex-agent/db/repos/balances.js";
import type { BalanceRow } from "@vex-agent/db/repos/balances.js";
import logger from "@utils/logger.js";

const ERC20_READ_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

/** DexScreener tokens/v1 caps at 30 addresses per request. */
const DEXSCREENER_TOKENS_BATCH = 30;

interface TokenMeta {
  decimals: number;
  symbol: string;
}

/**
 * In-process metadata cache keyed by `${chainId}:${lowercaseAddress}`. ERC-20
 * decimals/symbol are immutable, so caching avoids re-reading them every cycle.
 */
const metadataCache = new Map<string, TokenMeta>();

export interface LocalChainSyncResult {
  chainId: number;
  tokensUpdated: number;
  /** True when the chain was skipped (unknown/ non-EVM) or a soft failure. */
  skipped: boolean;
}

/**
 * Sync one local chain for one wallet: read balances, price them, and replace
 * the wallet's rows for this chain in `proj_balances`. Address-only — never
 * touches key material.
 *
 * Error boundary: the DB read (token scan set) and DB write (transactional
 * replace) sit OUTSIDE the RPC try/catch — a DB failure rejects loudly so the
 * worker marks the run failed (matching the Khalani path). Only the on-chain /
 * pricing reads in between are fail-soft.
 */
export async function syncLocalChainForWallet(
  family: ChainFamily,
  walletAddress: string,
  chainId: number,
): Promise<LocalChainSyncResult> {
  const config = getLocalChain(chainId);
  if (!config || family !== "eip155") {
    return { chainId, tokensUpdated: 0, skipped: true };
  }

  // DB READ — propagates. A failing tracked-token query is a local-DB fault the
  // operator must see, not a condition to paper over with a skipped chain.
  const tokenAddrs = await buildTokenScanSet(config, walletAddress);

  // RPC/TRANSPORT — fail-soft. No write happens on this path, so cached rows
  // for this chain survive a transient RPC outage (mirrors the Khalani native
  // top-up guard).
  let rows: BalanceRow[];
  try {
    const client = getLocalPublicClient(config);
    const meta = await loadTokenMetadata(client, chainId, tokenAddrs);
    const balances = await readErc20Balances(client, walletAddress, tokenAddrs);
    const nativeWei = await client.getBalance({ address: getAddress(walletAddress) });
    const priceByLower = await fetchPricesByLowerAddress(config, tokenAddrs);

    rows = buildBalanceRows({
      family,
      walletAddress,
      config,
      tokenAddrs,
      meta,
      balances,
      nativeWei,
      priceByLower,
    });
  } catch (err) {
    // SECURITY: never surface the raw provider error (it can carry the RPC URL /
    // HTML bodies) — log a bounded message class only.
    logger.warn("sync.local_chain.failed", {
      chainId,
      address: walletAddress.slice(0, 10) + "...",
      error: err instanceof Error ? err.name : "unknown",
    });
    return { chainId, tokensUpdated: 0, skipped: true };
  }

  // DB WRITE — propagates. A failed transactional replace must fail the sync
  // run visibly (worker retry semantics), never masquerade as a skipped chain.
  const count = await balancesRepo.replaceBalancesForChain(walletAddress, chainId, rows);
  logger.info("sync.local_chain.completed", {
    chainId,
    address: walletAddress.slice(0, 10) + "...",
    tokens: count,
    scanned: tokenAddrs.length,
  });
  return { chainId, tokensUpdated: count, skipped: false };
}

// ── Token scan set ──────────────────────────────────────────────────

/**
 * Seed set ∪ tracked tokens, deduped case-insensitively and checksummed.
 * Malformed tracked addresses are dropped defensively (untrusted DB rows).
 */
async function buildTokenScanSet(
  config: LocalChainConfig,
  walletAddress: string,
): Promise<`0x${string}`[]> {
  const byLower = new Map<string, `0x${string}`>();
  const add = (raw: string): void => {
    try {
      const checksummed = getAddress(raw);
      byLower.set(checksummed.toLowerCase(), checksummed);
    } catch {
      // Not a valid EVM address — skip (defensive against bad DB data).
    }
  };

  for (const token of config.seedTokens) add(token.address);

  const tracked = await activityRepo.getTrackedEvmTokensForChain({
    walletAddress,
    chainKeys: config.activityChainKeys.map((key) => key.toLowerCase()),
  });
  for (const address of tracked) add(address);

  return [...byLower.values()];
}

// ── On-chain reads ──────────────────────────────────────────────────

async function loadTokenMetadata(
  client: PublicClient<Transport, Chain>,
  chainId: number,
  tokenAddrs: readonly `0x${string}`[],
): Promise<Map<string, TokenMeta>> {
  const result = new Map<string, TokenMeta>();
  const missing: `0x${string}`[] = [];
  for (const address of tokenAddrs) {
    const cached = metadataCache.get(`${chainId}:${address.toLowerCase()}`);
    if (cached) result.set(address.toLowerCase(), cached);
    else missing.push(address);
  }
  if (missing.length === 0) return result;

  const contracts = missing.flatMap((address) => [
    { address, abi: ERC20_READ_ABI, functionName: "decimals" } as const,
    { address, abi: ERC20_READ_ABI, functionName: "symbol" } as const,
  ]);
  const reads = await client.multicall({ allowFailure: true, contracts });

  for (let i = 0; i < missing.length; i++) {
    const address = missing[i]!;
    const decimalsRead = reads[i * 2];
    const symbolRead = reads[i * 2 + 1];
    if (decimalsRead?.status !== "success" || symbolRead?.status !== "success") continue;
    const meta: TokenMeta = {
      decimals: Number(decimalsRead.result),
      symbol: String(symbolRead.result),
    };
    metadataCache.set(`${chainId}:${address.toLowerCase()}`, meta);
    result.set(address.toLowerCase(), meta);
  }
  return result;
}

/** Map lowercase token address → balance (wei) for reads that succeeded. */
async function readErc20Balances(
  client: PublicClient<Transport, Chain>,
  walletAddress: string,
  tokenAddrs: readonly `0x${string}`[],
): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  if (tokenAddrs.length === 0) return result;
  const owner = getAddress(walletAddress);
  const contracts = tokenAddrs.map(
    (address) => ({ address, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [owner] }) as const,
  );
  const reads = await client.multicall({ allowFailure: true, contracts });
  for (let i = 0; i < tokenAddrs.length; i++) {
    const read = reads[i];
    if (read?.status === "success") {
      result.set(tokenAddrs[i]!.toLowerCase(), read.result as bigint);
    }
  }
  return result;
}

// ── Pricing ─────────────────────────────────────────────────────────

/**
 * Best-liquidity DexScreener USD price per token (lowercase address → price).
 * Fail-soft: any error (incl. a chain slug DexScreener doesn't index) yields an
 * empty map, and priceless tokens simply keep a null USD value downstream.
 */
async function fetchPricesByLowerAddress(
  config: LocalChainConfig,
  tokenAddrs: readonly `0x${string}`[],
): Promise<Map<string, number>> {
  const priceByLower = new Map<string, number>();
  if (tokenAddrs.length === 0) return priceByLower;

  const wanted = new Set(tokenAddrs.map((address) => address.toLowerCase()));
  // Track the deepest liquidity seen per token so the chosen price is the
  // best-liquidity venue rather than an arbitrary pair.
  const bestLiquidity = new Map<string, number>();

  const client = getDexScreenerClient();
  for (let i = 0; i < tokenAddrs.length; i += DEXSCREENER_TOKENS_BATCH) {
    const batch = tokenAddrs.slice(i, i + DEXSCREENER_TOKENS_BATCH);
    try {
      const pairs = await client.getTokens(config.dexscreenerSlug, batch.join(","));
      for (const pair of pairs) {
        const base = pair.baseToken?.address?.toLowerCase();
        if (!base || !wanted.has(base) || pair.priceUsd == null) continue;
        const price = Number(pair.priceUsd);
        if (!Number.isFinite(price) || price < 0) continue;
        const liquidity = pair.liquidity?.usd ?? 0;
        if (!priceByLower.has(base) || liquidity > (bestLiquidity.get(base) ?? -Infinity)) {
          priceByLower.set(base, price);
          bestLiquidity.set(base, liquidity);
        }
      }
    } catch (err) {
      logger.debug("sync.local_chain.price_batch_failed", {
        slug: config.dexscreenerSlug,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }
  return priceByLower;
}

// ── Row assembly ────────────────────────────────────────────────────

function buildBalanceRows(input: {
  family: ChainFamily;
  walletAddress: string;
  config: LocalChainConfig;
  tokenAddrs: readonly `0x${string}`[];
  meta: Map<string, TokenMeta>;
  balances: Map<string, bigint>;
  nativeWei: bigint;
  priceByLower: Map<string, number>;
}): BalanceRow[] {
  const { family, walletAddress, config, tokenAddrs, meta, balances, nativeWei, priceByLower } = input;
  const rows: BalanceRow[] = [];

  // Native coin. Its USD price rides on wrapped-native (WETH), which is in the
  // seed set — ETH ≈ WETH. Zero native balances are skipped (Khalani parity).
  if (nativeWei > 0n) {
    const wrappedNativeLower = config.seedTokens
      .find((token) => token.label.toUpperCase() === `W${config.nativeCurrency.symbol.toUpperCase()}`)
      ?.address.toLowerCase();
    const nativePrice = wrappedNativeLower ? priceByLower.get(wrappedNativeLower) ?? null : null;
    rows.push(
      toRow(family, walletAddress, config.id, {
        tokenAddress: NATIVE_TOKEN_ADDRESS,
        symbol: config.nativeCurrency.symbol,
        decimals: config.nativeCurrency.decimals,
        balanceWei: nativeWei,
        priceUsd: nativePrice,
      }),
    );
  }

  for (const address of tokenAddrs) {
    const lower = address.toLowerCase();
    const balance = balances.get(lower);
    const tokenMeta = meta.get(lower);
    // Skip zero balances (Khalani only reports non-zero) and tokens whose
    // balance/metadata read failed (can't represent safely).
    if (balance === undefined || balance === 0n || !tokenMeta) continue;
    rows.push(
      toRow(family, walletAddress, config.id, {
        tokenAddress: address,
        symbol: tokenMeta.symbol,
        decimals: tokenMeta.decimals,
        balanceWei: balance,
        priceUsd: priceByLower.get(lower) ?? null,
      }),
    );
  }
  return rows;
}

function toRow(
  family: ChainFamily,
  walletAddress: string,
  chainId: number,
  token: { tokenAddress: string; symbol: string; decimals: number; balanceWei: bigint; priceUsd: number | null },
): BalanceRow {
  let balanceUsd: number | null = null;
  if (token.priceUsd !== null) {
    const human = Number(formatUnits(token.balanceWei, token.decimals));
    if (Number.isFinite(human)) balanceUsd = human * token.priceUsd;
  }
  return {
    walletFamily: family,
    walletAddress,
    chainId,
    tokenAddress: token.tokenAddress,
    tokenSymbol: token.symbol,
    tokenName: null,
    balanceRaw: token.balanceWei.toString(),
    balanceUsd,
    priceUsd: token.priceUsd,
    decimals: token.decimals,
  };
}

/** Test-only: clear the in-process metadata cache. */
export function resetLocalChainMetadataCache(): void {
  metadataCache.clear();
}
