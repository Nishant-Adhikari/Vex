/**
 * Jaine DEX (0G Network) swap, allowance, and W0G wrap/unwrap handlers.
 */

import { resolveToken, getTokenSymbol } from "@tools/jaine/coreTokens.js";
import { loadUserTokens } from "@tools/jaine/userTokens.js";
import { findBestRouteExactInput, findBestRouteExactOutput, formatRoute } from "@tools/jaine/routing.js";
import { getAllAllowances, safeApprove, revokeApproval, getSpenderAddress, ensureAllowance } from "@tools/jaine/allowance.js";
import { W0G_ABI } from "@tools/jaine/abi/w0g.js";
import { ROUTER_ABI } from "@tools/jaine/abi/router.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import { getSigningClient } from "@tools/wallet/signingClient.js";
import { loadConfig } from "@config/store.js";
import { isAddress, parseUnits, formatUnits, maxUint256, type Address, type Hex } from "viem";
import type { ToolResult } from "../../../../types.js";
import type { ProtocolHandler } from "../../../types.js";
import { str, num, ok, fail } from "../../../handler-helpers.js";
import { validateAddr, getTokenDecimals } from "./read.js";

// ── Handler map ──────────────────────────────────────────────────

export const SWAP_HANDLERS: Record<string, ProtocolHandler> = {
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

    // Resolve recipient
    const recipientRaw = str(p, "recipient");
    const recipient = recipientRaw && isAddress(recipientRaw) ? recipientRaw as Address : wallet.address as Address;

    // Ensure allowance
    await ensureAllowance(tokenIn, cfg.protocol.jaineRouter, amountIn, wallet.privateKey as Hex, p.approveExact === true);

    // Execute swap
    const walletClient = getSigningClient(wallet.privateKey as Hex);
    const deadlineSec = num(p, "deadlineSec") ?? 90;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);

    const txHash = await walletClient.writeContract({
      address: cfg.protocol.jaineRouter,
      abi: ROUTER_ABI,
      functionName: "exactInput",
      args: [{
        path: route.encodedPath,
        recipient,
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
          inputTokenAddress: tokenIn,
          outputTokenAddress: tokenOut,
          inputAmount: amountIn.toString(),
          outputAmount: route.amountOut.toString(),
          signature: txHash,
          walletAddress: wallet.address,
          tradeSide: "sell",
          instrumentKey: `0g:${tokenIn}`,
          valuationSource: "none",
          benchmarkAssetKey: tokenIn.toLowerCase() === cfg.protocol.w0g.toLowerCase() || tokenOut.toLowerCase() === cfg.protocol.w0g.toLowerCase() ? "0G" : undefined,
          settlementAssetKey: getTokenSymbol(tokenOut, userTokens.aliases),
          inputValueNative: tokenIn.toLowerCase() === cfg.protocol.w0g.toLowerCase() ? amountInRaw : undefined,
          outputValueNative: tokenOut.toLowerCase() === cfg.protocol.w0g.toLowerCase() ? formatUnits(route.amountOut, decimalsOut) : undefined,
          meta: { dex: "jaine", hops: route.tokens.length - 1 },
        },
      },
    };
  },

  "jaine.swap.buy": async (p) => {
    const tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountOutRaw = str(p, "amountOut");
    if (!tokenInRaw || !tokenOutRaw || !amountOutRaw) return fail("Missing required: tokenIn, tokenOut, amountOut");

    const userTokens = loadUserTokens();
    const tokenIn = resolveToken(tokenInRaw, userTokens.aliases);
    const tokenOut = resolveToken(tokenOutRaw, userTokens.aliases);
    const decimalsIn = await getTokenDecimals(tokenIn);
    const decimalsOut = await getTokenDecimals(tokenOut);
    const amountOut = parseUnits(amountOutRaw, decimalsOut);
    const slippageBps = num(p, "slippageBps") ?? 50;

    const route = await findBestRouteExactOutput(tokenIn, tokenOut, amountOut, {
      maxHops: num(p, "maxHops"),
    });

    if (!route) return fail("No route found for this swap");

    const amountInMaximum = (route.amountIn * BigInt(10000 + slippageBps)) / 10000n;
    const routeStr = formatRoute(route, userTokens.aliases);

    if (p.dryRun === true) {
      return ok({
        dryRun: true,
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amountOut: amountOut.toString(),
        amountIn: route.amountIn.toString(),
        amountInMaximum: amountInMaximum.toString(),
        route: routeStr,
        hops: route.tokens.length - 1,
        slippageBps,
        formatted: {
          amountOut: amountOutRaw,
          amountIn: formatUnits(route.amountIn, decimalsIn),
          amountInMaximum: formatUnits(amountInMaximum, decimalsIn),
        },
      });
    }

    const wallet = requireEvmWallet();
    const cfg = loadConfig();

    const recipientRaw = str(p, "recipient");
    const recipient = recipientRaw && isAddress(recipientRaw) ? recipientRaw as Address : wallet.address as Address;

    await ensureAllowance(tokenIn, cfg.protocol.jaineRouter, amountInMaximum, wallet.privateKey as Hex, p.approveExact === true);

    const walletClient = getSigningClient(wallet.privateKey as Hex);
    const deadlineSec = num(p, "deadlineSec") ?? 90;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);

    const txHash = await walletClient.writeContract({
      address: cfg.protocol.jaineRouter,
      abi: ROUTER_ABI,
      functionName: "exactOutput",
      args: [{
        path: route.encodedPath,
        recipient,
        deadline,
        amountOut,
        amountInMaximum,
      }],
    });

    return {
      success: true,
      output: JSON.stringify({
        txHash, route: routeStr,
        tokenIn: getTokenSymbol(tokenIn, userTokens.aliases),
        tokenOut: getTokenSymbol(tokenOut, userTokens.aliases),
        amountOut: amountOutRaw,
        amountInExpected: formatUnits(route.amountIn, decimalsIn),
      }, null, 2),
      data: {
        txHash,
        _tradeCapture: {
          type: "swap",
          chain: "0g",
          status: "executed",
          inputToken: getTokenSymbol(tokenIn, userTokens.aliases),
          outputToken: getTokenSymbol(tokenOut, userTokens.aliases),
          inputTokenAddress: tokenIn,
          outputTokenAddress: tokenOut,
          inputAmount: route.amountIn.toString(),
          outputAmount: amountOut.toString(),
          signature: txHash,
          walletAddress: wallet.address,
          tradeSide: "buy",
          instrumentKey: `0g:${tokenOut}`,
          valuationSource: "none",
          benchmarkAssetKey: tokenIn.toLowerCase() === cfg.protocol.w0g.toLowerCase() || tokenOut.toLowerCase() === cfg.protocol.w0g.toLowerCase() ? "0G" : undefined,
          settlementAssetKey: getTokenSymbol(tokenIn, userTokens.aliases),
          inputValueNative: tokenIn.toLowerCase() === cfg.protocol.w0g.toLowerCase() ? formatUnits(route.amountIn, decimalsIn) : undefined,
          outputValueNative: tokenOut.toLowerCase() === cfg.protocol.w0g.toLowerCase() ? amountOutRaw : undefined,
          meta: { dex: "jaine", direction: "exactOutput", hops: route.tokens.length - 1 },
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
    return { success: true, output: JSON.stringify({ token, spender: spenderType, spenderAddress: spender, txHash: result.txHash, resetTxHash: result.resetTxHash }, null, 2), data: { txHash: result.txHash, _tradeCapture: { type: "allowance", chain: "0g", status: "executed", inputTokenAddress: token, walletAddress: wallet.address, signature: result.txHash, meta: { action: "approve", spenderType, spenderAddress: spender, resetTxHash: result.resetTxHash } } } };
  },

  "jaine.allowance.revoke": async (p) => {
    const token = str(p, "token"), spenderType = str(p, "spender");
    if (!token || !spenderType) return fail("Missing required: token, spender");
    if (spenderType !== "router" && spenderType !== "nft") return fail("spender must be: router or nft");

    const wallet = requireEvmWallet();
    const spender = getSpenderAddress(spenderType);
    const txHash = await revokeApproval(token as Address, spender, wallet.privateKey as Hex);
    return { success: true, output: JSON.stringify({ token, spender: spenderType, spenderAddress: spender, txHash, status: "revoked" }, null, 2), data: { txHash, _tradeCapture: { type: "allowance", chain: "0g", status: "executed", inputTokenAddress: token, walletAddress: wallet.address, signature: txHash, meta: { action: "revoke", spenderType, spenderAddress: spender } } } };
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

    return { success: true, output: JSON.stringify({ txHash, amount: amount.toString(), formatted: amountRaw, action: "wrap" }, null, 2), data: { txHash, _tradeCapture: { type: "wrap", chain: "0g", status: "executed", inputToken: "0G", outputToken: "w0G", inputAmount: amount.toString(), walletAddress: wallet.address, signature: txHash, meta: { action: "wrap" } } } };
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

    return { success: true, output: JSON.stringify({ txHash, amount: amount.toString(), formatted: amountRaw, action: "unwrap" }, null, 2), data: { txHash, _tradeCapture: { type: "wrap", chain: "0g", status: "executed", inputToken: "w0G", outputToken: "0G", inputAmount: amount.toString(), walletAddress: wallet.address, signature: txHash, meta: { action: "unwrap" } } } };
  },
};
