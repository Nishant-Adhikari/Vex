/**
 * Slop.money (0G Network) read-only handlers — token info, price, curve, fees, rewards.
 */

import { isAddress, getAddress, formatUnits, type Address } from "viem";
import { getPublicClient } from "@tools/wallet/client.js";
import { loadConfig } from "@config/store.js";
import { SLOP_TOKEN_ABI } from "@tools/slop/abi/token.js";
import { SLOP_REGISTRY_ABI } from "@tools/slop/abi/registry.js";
import { SLOP_FEE_COLLECTOR_ABI } from "@tools/slop/abi/feeCollector.js";
import {
  calculateGraduationProgress,
} from "@tools/slop/quote.js";
import {
  validateOfficialToken,
  getTokenState,
} from "@tools/slop/validation.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import type { ToolResult } from "../../../../types.js";
import type { ProtocolHandler } from "../../../types.js";
import { str, num, ok, fail } from "../../../handler-helpers.js";

// ── Shared helper (exported for mutate handlers) ────────────────

export function requireTokenAddr(p: Record<string, unknown>): Address | ToolResult {
  const raw = str(p, "token");
  if (!raw) return fail("Missing required: token");
  if (!isAddress(raw)) return fail(`Invalid address: ${raw}`);
  return getAddress(raw);
}

// ── Handler map ──────────────────────────────────────────────────

export const VIEW_HANDLERS: Record<string, ProtocolHandler> = {
  "slop.token.info": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [name, symbol, metadata, creator, creationTime, state, tradeInfo, [price, priceSource]] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "name" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "metadata" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "creator" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "creationTime" }),
      getTokenState(addr),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "tradeInfo" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "getCurrentPrice" }),
    ]);

    const graduationProgress = calculateGraduationProgress(state.tokenReserves, state.virtualTokenReserves, state.curveSupply);

    return ok({
      token: addr, name, symbol, creator,
      creationTime: creationTime.toString(),
      isGraduated: state.isGraduated,
      price: formatUnits(price, 18),
      priceSource: priceSource === 0 ? "bonding" : "pool",
      graduationProgressPct: (Number(graduationProgress) / 100).toFixed(2),
      reserves: {
        og: state.ogReserves.toString(),
        token: state.tokenReserves.toString(),
        k: state.k.toString(),
      },
      fees: { buyBps: Number(state.buyFeeBps), sellBps: Number(state.sellFeeBps) },
      tradeInfo: {
        totalVolume: tradeInfo[0].toString(),
        totalTransactions: tradeInfo[1].toString(),
        buyCount: tradeInfo[2].toString(),
        sellCount: tradeInfo[3].toString(),
        uniqueTraders: tradeInfo[4].toString(),
      },
      metadata: { description: metadata[0], imageUrl: metadata[1], twitter: metadata[2], telegram: metadata[3], website: metadata[4] },
    });
  },

  "slop.tokens.mine": async (p) => {
    const cfg = loadConfig();
    const client = getPublicClient();

    let creatorAddr: Address;
    const raw = str(p, "creator");
    if (raw) {
      if (!isAddress(raw)) return fail(`Invalid address: ${raw}`);
      creatorAddr = getAddress(raw);
    } else {
      const wallet = requireEvmWallet();
      creatorAddr = wallet.address as Address;
    }

    const tokenAddresses = await client.readContract({
      address: cfg.slop.tokenRegistry,
      abi: SLOP_REGISTRY_ABI,
      functionName: "getCreatorTokens",
      args: [creatorAddr],
    });

    if (tokenAddresses.length === 0) {
      return ok({ creator: creatorAddr, tokens: [], count: 0 });
    }

    const tokenInfos = await client.readContract({
      address: cfg.slop.tokenRegistry,
      abi: SLOP_REGISTRY_ABI,
      functionName: "getTokensInfo",
      args: [tokenAddresses as Address[]],
    });

    const tokens = tokenAddresses.map((addr, i) => ({
      address: addr,
      name: tokenInfos[i].name,
      symbol: tokenInfos[i].symbol,
      createdAt: tokenInfos[i].createdAt.toString(),
      isGraduated: tokenInfos[i].isGraduated,
    }));

    return ok({ creator: creatorAddr, count: tokens.length, tokens });
  },

  // ── View ───────────────────────────────────────────────────────

  "slop.price": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [[price, priceSource], symbol] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "getCurrentPrice" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
    ]);

    return ok({ token: addr, symbol, price: formatUnits(price, 18), source: priceSource === 0 ? "bonding" : "pool" });
  },

  "slop.curve": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();
    const state = await getTokenState(addr);
    const symbol = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" });

    const graduationProgress = calculateGraduationProgress(state.tokenReserves, state.virtualTokenReserves, state.curveSupply);
    const tokensSold = state.virtualTokenReserves > state.tokenReserves ? state.virtualTokenReserves - state.tokenReserves : 0n;

    return ok({
      token: addr, symbol, isGraduated: state.isGraduated,
      graduationProgressPct: (Number(graduationProgress) / 100).toFixed(2),
      reserves: {
        og: state.ogReserves.toString(), token: state.tokenReserves.toString(),
        virtualOg: state.virtualOgReserves.toString(), virtualToken: state.virtualTokenReserves.toString(),
        k: state.k.toString(),
      },
      curveSupply: state.curveSupply.toString(),
      tokensSold: tokensSold.toString(),
      fees: { buyBps: Number(state.buyFeeBps), sellBps: Number(state.sellFeeBps) },
    });
  },

  // ── Fees (read-only) ──────────────────────────────────────────

  "slop.fees.stats": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const cfg = loadConfig();
    const client = getPublicClient();

    const [feeStats, symbol] = await Promise.all([
      client.readContract({ address: cfg.slop.feeCollector, abi: SLOP_FEE_COLLECTOR_ABI, functionName: "getTokenFeeStats", args: [addr] }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
    ]);

    const [totalCreator, totalPlatform, pendingCreator, pendingPlatform, volume] = feeStats;

    return ok({
      token: addr, symbol,
      totalCreatorFees: formatUnits(totalCreator, 18),
      totalPlatformFees: formatUnits(totalPlatform, 18),
      pendingCreatorFees: formatUnits(pendingCreator, 18),
      pendingPlatformFees: formatUnits(pendingPlatform, 18),
      totalVolume: formatUnits(volume, 18),
    });
  },

  "slop.fees.lpPending": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [isGraduated, symbol] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
    ]);

    if (!isGraduated) {
      return ok({ token: addr, symbol, isGraduated: false, pendingW0G: "0", pendingToken: "0", note: "Token not graduated — no LP fees yet" });
    }

    const [pendingW0G, pendingToken] = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "getPendingLPFees" });

    return ok({ token: addr, symbol, isGraduated: true, pendingW0G: formatUnits(pendingW0G, 18), pendingToken: formatUnits(pendingToken, 18) });
  },

  // ── Reward (read-only) ────────────────────────────────────────

  "slop.reward.pending": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const client = getPublicClient();

    const [pendingReward, totalReward, symbol, isGraduated] = await Promise.all([
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "pendingCreatorReward" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "CREATOR_GRADUATION_REWARD" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" }),
      client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "isGraduated" }),
    ]);

    return ok({ token: addr, symbol, isGraduated, pendingReward: formatUnits(pendingReward, 18), totalReward: formatUnits(totalReward, 18) });
  },
};
