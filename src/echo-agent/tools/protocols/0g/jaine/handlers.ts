/**
 * Jaine DEX (0G Network) protocol handlers — direct TS client calls.
 *
 * Subgraph queries import from @tools/jaine/subgraph/client.
 * Execution layer imports from @tools/jaine/routing, allowance, coreTokens.
 * Wallet via @tools/wallet/multi-auth.
 */

import { subgraphClient } from "@tools/jaine/subgraph/client.js";
import { CORE_TOKENS, resolveToken, getTokenSymbol } from "@tools/jaine/coreTokens.js";
import { loadUserTokens } from "@tools/jaine/userTokens.js";
import { findBestRouteExactInput, formatRoute } from "@tools/jaine/routing.js";
import { getAllAllowances, safeApprove, revokeApproval, getSpenderAddress, ensureAllowance } from "@tools/jaine/allowance.js";
import { W0G_ABI } from "@tools/jaine/abi/w0g.js";
import { ROUTER_ABI } from "@tools/jaine/abi/router.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import { getPublicClient } from "@tools/wallet/client.js";
import { getSigningClient } from "@tools/wallet/signingClient.js";
import { loadConfig } from "@config/store.js";
import { parseUnits, formatUnits, maxUint256, type Address, type Hex } from "viem";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler } from "../../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

async function getTokenDecimals(token: Address): Promise<number> {
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

export const JAINE_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Pools discovery ───────────────────────────────────────────

  "jaine.meta": async () => {
    const meta = await subgraphClient.getMeta();
    return ok(meta);
  },

  "jaine.pools.top": async (p) => {
    const limit = num(p, "limit") ?? 20;
    const skip = num(p, "skip") ?? 0;
    const pools = await subgraphClient.getTopPools(limit, skip);
    return ok({ count: pools.length, pools });
  },

  "jaine.pools.forToken": async (p) => {
    const token = str(p, "token");
    if (!token) return fail("Missing required: token");
    const pools = await subgraphClient.getPoolsForToken(token, {
      limit: num(p, "limit"),
      skip: num(p, "skip"),
    });
    return ok({ token, count: pools.length, pools });
  },

  "jaine.pools.forPair": async (p) => {
    const tokenA = str(p, "tokenA"), tokenB = str(p, "tokenB");
    if (!tokenA || !tokenB) return fail("Missing required: tokenA, tokenB");
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
    if (!poolId) return fail("Missing required: poolId");
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
    if (!address) return fail("Missing required: address");
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

  // ── Swap ──────────────────────────────────────────────────────

  "jaine.swap.quote": async (p) => {
    const tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
    if (!tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: tokenIn, tokenOut, amountIn");

    const userTokens = loadUserTokens();
    const tokenIn = resolveToken(tokenInRaw, userTokens.aliases);
    const tokenOut = resolveToken(tokenOutRaw, userTokens.aliases);
    const decimalsIn = await getTokenDecimals(tokenIn);
    const decimalsOut = await getTokenDecimals(tokenOut);
    const amountIn = parseUnits(amountInRaw, decimalsIn);

    const route = await findBestRouteExactInput(tokenIn, tokenOut, amountIn, {
      maxHops: num(p, "maxHops"),
    });

    if (!route) return fail("No route found for this swap");

    const routeStr = formatRoute(route, userTokens.aliases);
    return ok({
      tokenIn: { address: tokenIn, symbol: getTokenSymbol(tokenIn, userTokens.aliases) },
      tokenOut: { address: tokenOut, symbol: getTokenSymbol(tokenOut, userTokens.aliases) },
      amountIn: amountIn.toString(),
      amountOut: route.amountOut.toString(),
      route: routeStr,
      hops: route.tokens.length - 1,
      formatted: {
        amountIn: amountInRaw,
        amountOut: formatUnits(route.amountOut, decimalsOut),
      },
    });
  },

  "jaine.swap.sell": async (p) => {
    const tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
    if (!tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: tokenIn, tokenOut, amountIn");

    const userTokens = loadUserTokens();
    const tokenIn = resolveToken(tokenInRaw, userTokens.aliases);
    const tokenOut = resolveToken(tokenOutRaw, userTokens.aliases);
    const decimalsIn = await getTokenDecimals(tokenIn);
    const decimalsOut = await getTokenDecimals(tokenOut);
    const amountIn = parseUnits(amountInRaw, decimalsIn);
    const slippageBps = num(p, "slippageBps") ?? 50;

    const route = await findBestRouteExactInput(tokenIn, tokenOut, amountIn, {
      maxHops: num(p, "maxHops"),
    });

    if (!route) return fail("No route found for this swap");

    const amountOutMinimum = (route.amountOut * BigInt(10000 - slippageBps)) / 10000n;
    const routeStr = formatRoute(route, userTokens.aliases);

    if (p.dryRun === true) {
      return ok({
        dryRun: true,
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amountIn: amountIn.toString(),
        amountOut: route.amountOut.toString(),
        amountOutMinimum: amountOutMinimum.toString(),
        route: routeStr,
        hops: route.tokens.length - 1,
        slippageBps,
        formatted: {
          amountIn: amountInRaw,
          amountOut: formatUnits(route.amountOut, decimalsOut),
          amountOutMinimum: formatUnits(amountOutMinimum, decimalsOut),
        },
      });
    }

    const wallet = requireEvmWallet();
    const cfg = loadConfig();

    // Ensure allowance
    await ensureAllowance(tokenIn, cfg.protocol.jaineRouter, amountIn, wallet.privateKey as Hex);

    // Execute swap
    const walletClient = getSigningClient(wallet.privateKey as Hex);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);

    const txHash = await walletClient.writeContract({
      address: cfg.protocol.jaineRouter,
      abi: ROUTER_ABI,
      functionName: "exactInput",
      args: [{
        path: route.encodedPath,
        recipient: wallet.address as Address,
        deadline,
        amountIn,
        amountOutMinimum,
      }],
    });

    return {
      success: true,
      output: JSON.stringify({
        txHash, route: routeStr,
        tokenIn: getTokenSymbol(tokenIn, userTokens.aliases),
        tokenOut: getTokenSymbol(tokenOut, userTokens.aliases),
        amountIn: amountInRaw,
        amountOutExpected: formatUnits(route.amountOut, decimalsOut),
      }, null, 2),
      data: {
        txHash,
        _tradeCapture: {
          type: "swap",
          chain: "0g",
          status: "executed",
          inputToken: getTokenSymbol(tokenIn, userTokens.aliases),
          outputToken: getTokenSymbol(tokenOut, userTokens.aliases),
          inputAmount: amountIn.toString(),
          outputAmount: route.amountOut.toString(),
          signature: txHash,
          meta: { dex: "jaine", hops: route.tokens.length - 1 },
        },
      },
    };
  },

  // ── Allowance ─────────────────────────────────────────────────

  "jaine.allowance.check": async (p) => {
    const token = str(p, "token");
    if (!token) return fail("Missing required: token");
    const wallet = requireEvmWallet();
    const allowances = await getAllAllowances(token as Address, wallet.address as Address);
    return ok({
      token,
      owner: wallet.address,
      router: allowances.router.toString(),
      nft: allowances.nft.toString(),
    });
  },

  "jaine.allowance.approve": async (p) => {
    const token = str(p, "token"), spenderType = str(p, "spender");
    if (!token || !spenderType) return fail("Missing required: token, spender");
    if (spenderType !== "router" && spenderType !== "nft") return fail("spender must be: router or nft");

    const wallet = requireEvmWallet();
    const spender = getSpenderAddress(spenderType);
    const amountRaw = str(p, "amount");
    const approveExact = p.approveExact === true;

    let amount = maxUint256;
    if (amountRaw) {
      const decimals = await getTokenDecimals(token as Address);
      amount = parseUnits(amountRaw, decimals);
    }

    const result = await safeApprove(token as Address, spender, approveExact ? amount : maxUint256, wallet.privateKey as Hex);
    return ok({ token, spender: spenderType, spenderAddress: spender, txHash: result.txHash, resetTxHash: result.resetTxHash });
  },

  "jaine.allowance.revoke": async (p) => {
    const token = str(p, "token"), spenderType = str(p, "spender");
    if (!token || !spenderType) return fail("Missing required: token, spender");
    if (spenderType !== "router" && spenderType !== "nft") return fail("spender must be: router or nft");

    const wallet = requireEvmWallet();
    const spender = getSpenderAddress(spenderType);
    const txHash = await revokeApproval(token as Address, spender, wallet.privateKey as Hex);
    return ok({ token, spender: spenderType, spenderAddress: spender, txHash, status: "revoked" });
  },

  // ── W0G wrap/unwrap ───────────────────────────────────────────

  "jaine.w0g.wrap": async (p) => {
    const amountRaw = str(p, "amount");
    if (!amountRaw) return fail("Missing required: amount");

    const amount = parseUnits(amountRaw, 18);
    if (amount <= 0n) return fail("Amount must be greater than 0");

    const wallet = requireEvmWallet();
    const cfg = loadConfig();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: cfg.protocol.w0g,
      abi: W0G_ABI,
      functionName: "deposit",
      value: amount,
    });

    return ok({ txHash, amount: amount.toString(), formatted: amountRaw, action: "wrap" });
  },

  "jaine.w0g.unwrap": async (p) => {
    const amountRaw = str(p, "amount");
    if (!amountRaw) return fail("Missing required: amount");

    const amount = parseUnits(amountRaw, 18);
    if (amount <= 0n) return fail("Amount must be greater than 0");

    const wallet = requireEvmWallet();
    const cfg = loadConfig();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: cfg.protocol.w0g,
      abi: W0G_ABI,
      functionName: "withdraw",
      args: [amount],
    });

    return ok({ txHash, amount: amount.toString(), formatted: amountRaw, action: "unwrap" });
  },
};
