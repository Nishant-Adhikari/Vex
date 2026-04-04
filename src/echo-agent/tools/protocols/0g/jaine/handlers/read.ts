/**
 * Jaine DEX (0G Network) read-only handlers — subgraph queries + token info.
 */

import { subgraphClient } from "@tools/jaine/subgraph/client.js";
import { CORE_TOKENS } from "@tools/jaine/coreTokens.js";
import { isAddress, type Address } from "viem";
import type { ToolResult } from "../../../../types.js";
import type { ProtocolHandler } from "../../../types.js";
import { str, num, ok, fail } from "../../../handler-helpers.js";
import { getPublicClient } from "@tools/wallet/client.js";

// ── Shared helpers (exported for swap handlers) ─────────────────

export function validateAddr(value: string, field: string): ToolResult | null {
  if (!value) return fail(`Missing required: ${field}`);
  if (!isAddress(value)) return fail(`Invalid address for ${field}: ${value}`);
  return null;
}

export async function getTokenDecimals(token: Address): Promise<number> {
  const client = getPublicClient();
  try {
    const decimals = await client.readContract({
      address: token,
      abi: [{ name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }],
      functionName: "decimals",
    });
    const n = Number(decimals);
    return Number.isFinite(n) && n >= 0 && n <= 255 ? n : 18;
  } catch {
    return 18;
  }
}

// ── Handler map ──────────────────────────────────────────────────

export const READ_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Pools discovery ───────────────────────────────────────────

  "jaine.meta": async () => {
    const meta = await subgraphClient.getMeta();
    return ok(meta);
  },

  "jaine.pools.top": async (p) => {
    const limit = num(p, "limit") ?? 20;
    const skip = num(p, "skip") ?? 0;
    let pools = await subgraphClient.getTopPools(limit, skip);
    const minTvl = num(p, "minTvl");
    if (minTvl != null) {
      pools = pools.filter(pool => parseFloat(pool.totalValueLockedUSD) >= minTvl);
    }
    return ok({ count: pools.length, pools });
  },

  "jaine.pools.forToken": async (p) => {
    const token = str(p, "token");
    const addrErr = validateAddr(token, "token");
    if (addrErr) return addrErr;
    const pools = await subgraphClient.getPoolsForToken(token, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ token, count: pools.length, pools });
  },

  "jaine.pools.forPair": async (p) => {
    const tokenA = str(p, "tokenA"), tokenB = str(p, "tokenB");
    const errA = validateAddr(tokenA, "tokenA");
    if (errA) return errA;
    const errB = validateAddr(tokenB, "tokenB");
    if (errB) return errB;
    const pools = await subgraphClient.getPoolsForPair(tokenA, tokenB, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ tokenA, tokenB, count: pools.length, pools });
  },

  "jaine.pools.newest": async (p) => {
    const limit = num(p, "limit") ?? 20;
    const pools = await subgraphClient.getNewestPools(limit);
    return ok({ count: pools.length, pools });
  },

  // ── Single pool ───────────────────────────────────────────────

  "jaine.pool.info": async (p) => {
    const poolId = str(p, "poolId");
    const poolErr = validateAddr(poolId, "poolId");
    if (poolErr) return poolErr;
    const pool = await subgraphClient.getPool(poolId);
    if (!pool) return fail(`Pool not found: ${poolId}`);
    return ok(pool);
  },

  "jaine.pool.days": async (p) => {
    const poolId = str(p, "poolId");
    if (!poolId) return fail("Missing required: poolId");
    const data = await subgraphClient.getPoolDayData(poolId, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ poolId, count: data.length, dayData: data });
  },

  "jaine.pool.hours": async (p) => {
    const poolId = str(p, "poolId");
    if (!poolId) return fail("Missing required: poolId");
    const data = await subgraphClient.getPoolHourData(poolId, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ poolId, count: data.length, hourData: data });
  },

  "jaine.pool.swaps": async (p) => {
    const poolId = str(p, "poolId");
    if (!poolId) return fail("Missing required: poolId");
    const swaps = await subgraphClient.getRecentSwaps(poolId, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ poolId, count: swaps.length, swaps });
  },

  "jaine.pool.mints": async (p) => {
    const poolId = str(p, "poolId");
    if (!poolId) return fail("Missing required: poolId");
    const mints = await subgraphClient.getMints(poolId, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ poolId, count: mints.length, mints });
  },

  "jaine.pool.burns": async (p) => {
    const poolId = str(p, "poolId");
    if (!poolId) return fail("Missing required: poolId");
    const burns = await subgraphClient.getBurns(poolId, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ poolId, count: burns.length, burns });
  },

  "jaine.pool.collects": async (p) => {
    const poolId = str(p, "poolId");
    if (!poolId) return fail("Missing required: poolId");
    const collects = await subgraphClient.getCollects(poolId, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ poolId, count: collects.length, collects });
  },

  // ── Tokens ────────────────────────────────────────────────────

  "jaine.token.info": async (p) => {
    const address = str(p, "address");
    const tokenErr = validateAddr(address, "address");
    if (tokenErr) return tokenErr;
    const token = await subgraphClient.getToken(address);
    if (!token) return fail(`Token not found: ${address}`);
    return ok(token);
  },

  "jaine.tokens.top": async (p) => {
    const by = str(p, "by") === "volume" ? "volume" as const : "tvl" as const;
    const tokens = await subgraphClient.getTopTokens({
      limit: num(p, "limit"),
      skip: num(p, "skip"),
      by,
    });
    return ok({ sortedBy: by, count: tokens.length, tokens });
  },

  "jaine.tokens.list": async () => {
    const tokens = Object.entries(CORE_TOKENS).map(([symbol, address]) => ({ symbol, address }));
    return ok({ count: tokens.length, tokens });
  },

  // ── DEX stats ─────────────────────────────────────────────────

  "jaine.dex.stats": async (p) => {
    const limit = num(p, "limit") ?? 30;
    const data = await subgraphClient.getDexDayData(limit);
    return ok({ count: data.length, dexDayData: data });
  },
};
