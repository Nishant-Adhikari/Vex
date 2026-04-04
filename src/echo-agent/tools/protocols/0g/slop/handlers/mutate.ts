/**
 * Slop.money (0G Network) mutating handlers — create, trade, claim.
 */

import { randomBytes } from "node:crypto";
import { isAddress, getAddress, parseUnits, formatUnits, decodeEventLog, type Address, type Hex } from "viem";
import { getPublicClient } from "@tools/wallet/client.js";
import { getSigningClient } from "@tools/wallet/signingClient.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import { loadConfig } from "@config/store.js";
import { SLOP_FACTORY_ABI } from "@tools/slop/abi/factory.js";
import { SLOP_TOKEN_ABI } from "@tools/slop/abi/token.js";
import { SLOP_FEE_COLLECTOR_ABI } from "@tools/slop/abi/feeCollector.js";
import {
  calculatePartialFill,
  calculateOgOut,
  applySlippage,
} from "@tools/slop/quote.js";
import {
  validateOfficialToken,
  checkNotGraduated,
  checkTradingEnabled,
  getTokenState,
  parseUnitsSafe,
  validateUserSalt,
} from "@tools/slop/validation.js";
import type { ProtocolHandler } from "../../../types.js";
import { str, num, ok, fail } from "../../../handler-helpers.js";
import { requireTokenAddr } from "./view.js";

// ── Handler map ──────────────────────────────────────────────────

export const MUTATE_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Token ──────────────────────────────────────────────────────

  "slop.token.create": async (p) => {
    const name = str(p, "name"), symbol = str(p, "symbol");
    if (!name || !symbol) return fail("Missing required: name, symbol");

    const wallet = requireEvmWallet();
    const cfg = loadConfig();

    let userSalt: Hex;
    const saltRaw = str(p, "userSalt");
    if (saltRaw) {
      userSalt = validateUserSalt(saltRaw);
    } else {
      userSalt = `0x${randomBytes(32).toString("hex")}` as Hex;
    }

    const walletClient = getSigningClient(wallet.privateKey as Hex);
    const publicClient = getPublicClient();

    const txHash = await walletClient.writeContract({
      address: cfg.slop.factory,
      abi: SLOP_FACTORY_ABI,
      functionName: "createToken",
      args: [
        name,
        symbol,
        str(p, "description") || "",
        str(p, "imageUrl") || "",
        str(p, "twitter") || "",
        str(p, "telegram") || "",
        str(p, "website") || "",
        userSalt,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    let tokenAddress: Address | undefined;
    let tokenId: bigint | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== cfg.slop.factory.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: SLOP_FACTORY_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "TokenCreated") {
          tokenAddress = decoded.args.tokenAddress as Address;
          tokenId = decoded.args.tokenId as bigint;
          break;
        }
      } catch { /* not TokenCreated */ }
    }

    if (!tokenAddress) return fail("Failed to decode TokenCreated event from receipt");

    return { success: true, output: JSON.stringify({ txHash, tokenAddress, tokenId: tokenId?.toString(), name, symbol }, null, 2), data: { txHash, _tradeCapture: { type: "token_create", chain: "0g", status: "executed", instrumentKey: `0g:${tokenAddress}`, walletAddress: wallet.address, signature: txHash, meta: { tokenAddress, tokenId: tokenId?.toString(), name, symbol } } } };
  },

  // ── Trade ──────────────────────────────────────────────────────

  "slop.trade.buy": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;
    const amountOgRaw = str(p, "amountOg");
    if (!amountOgRaw) return fail("Missing required: amountOg");

    await validateOfficialToken(addr);
    await checkNotGraduated(addr);
    await checkTradingEnabled(addr);

    const slippageBps = num(p, "slippageBps") ?? 50;
    const ogAmountWei = parseUnitsSafe(amountOgRaw, 18, "amountOg");
    if (ogAmountWei <= 0n) return fail("Amount must be > 0");

    const state = await getTokenState(addr);
    const client = getPublicClient();

    const quote = calculatePartialFill(
      state.ogReserves, state.tokenReserves, state.virtualTokenReserves,
      state.curveSupply, ogAmountWei, state.buyFeeBps,
    );

    const minTokensOut = applySlippage(quote.tokensOut, BigInt(slippageBps));
    const symbol = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" });

    if (p.dryRun === true) {
      return ok({
        dryRun: true, token: addr, symbol,
        amountOg: amountOgRaw,
        tokensOut: formatUnits(quote.tokensOut, 18),
        minTokensOut: formatUnits(minTokensOut, 18),
        fee: formatUnits(quote.feeUsed, 18),
        refund: formatUnits(quote.refund, 18),
        hitCap: quote.hitCap,
        slippageBps,
      });
    }

    const wallet = requireEvmWallet();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "buyWithSlippage",
      args: [minTokensOut],
      value: ogAmountWei,
    });

    return {
      success: true,
      output: JSON.stringify({ txHash, token: addr, symbol, amountOg: amountOgRaw, tokensOut: formatUnits(quote.tokensOut, 18), hitCap: quote.hitCap }, null, 2),
      data: { txHash, _tradeCapture: { type: "swap", chain: "0g", status: "executed", inputToken: "0G", outputToken: symbol, outputTokenAddress: addr, inputAmount: ogAmountWei.toString(), outputAmount: quote.tokensOut.toString(), signature: txHash, walletAddress: wallet.address, tradeSide: "buy", instrumentKey: `0g:${addr}`, valuationSource: "none", benchmarkAssetKey: "0G", settlementAssetKey: "0G", inputValueNative: formatUnits(ogAmountWei, 18), meta: { dex: "slop", action: "buy", hitCap: quote.hitCap } } },
    };
  },

  "slop.trade.sell": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;
    const amountTokensRaw = str(p, "amountTokens");
    if (!amountTokensRaw) return fail("Missing required: amountTokens");

    await validateOfficialToken(addr);
    await checkNotGraduated(addr);
    await checkTradingEnabled(addr);

    const slippageBps = num(p, "slippageBps") ?? 50;
    const tokenAmountWei = parseUnitsSafe(amountTokensRaw, 18, "amountTokens");
    if (tokenAmountWei <= 0n) return fail("Amount must be > 0");

    const state = await getTokenState(addr);
    const client = getPublicClient();

    const ogOutGross = calculateOgOut(state.k, state.ogReserves, state.tokenReserves, tokenAmountWei);
    const fee = (ogOutGross * state.sellFeeBps) / 10000n;
    const ogOutNet = ogOutGross - fee;
    const minOgOut = applySlippage(ogOutNet, BigInt(slippageBps));

    const symbol = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "symbol" });

    if (p.dryRun === true) {
      return ok({
        dryRun: true, token: addr, symbol,
        amountTokens: amountTokensRaw,
        ogOutNet: formatUnits(ogOutNet, 18),
        minOgOut: formatUnits(minOgOut, 18),
        fee: formatUnits(fee, 18),
        slippageBps,
      });
    }

    const wallet = requireEvmWallet();

    // Check balance
    const balance = await client.readContract({ address: addr, abi: SLOP_TOKEN_ABI, functionName: "balanceOf", args: [wallet.address as Address] });
    if (balance < tokenAmountWei) return fail(`Insufficient balance: ${formatUnits(balance, 18)} ${symbol} (need ${amountTokensRaw})`);

    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "sellWithSlippage",
      args: [tokenAmountWei, minOgOut],
    });

    return {
      success: true,
      output: JSON.stringify({ txHash, token: addr, symbol, amountTokens: amountTokensRaw, ogOutNet: formatUnits(ogOutNet, 18) }, null, 2),
      data: { txHash, _tradeCapture: { type: "swap", chain: "0g", status: "executed", inputToken: symbol, inputTokenAddress: addr, outputToken: "0G", inputAmount: tokenAmountWei.toString(), outputAmount: ogOutNet.toString(), signature: txHash, walletAddress: wallet.address, tradeSide: "sell", instrumentKey: `0g:${addr}`, valuationSource: "none", benchmarkAssetKey: "0G", settlementAssetKey: "0G", outputValueNative: formatUnits(ogOutNet, 18), meta: { dex: "slop", action: "sell" } } },
    };
  },

  // ── Fees (mutating) ───────────────────────────────────────────

  "slop.fees.claimCreator": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const wallet = requireEvmWallet();
    const cfg = loadConfig();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: cfg.slop.feeCollector,
      abi: SLOP_FEE_COLLECTOR_ABI,
      functionName: "withdrawCreatorFees",
      args: [addr],
    });

    return { success: true, output: JSON.stringify({ txHash, token: addr, action: "claimCreatorFees" }, null, 2), data: { txHash, _tradeCapture: { type: "reward", chain: "0g", status: "executed", walletAddress: wallet.address, signature: txHash, instrumentKey: `0g:${addr}`, meta: { action: "claimCreatorFees", token: addr } } } };
  },

  "slop.fees.lpCollect": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const wallet = requireEvmWallet();
    const recipientRaw = str(p, "recipient");
    const recipient = recipientRaw && isAddress(recipientRaw) ? getAddress(recipientRaw) : wallet.address as Address;

    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "collectLPFees",
      args: [recipient],
    });

    return { success: true, output: JSON.stringify({ txHash, token: addr, recipient, action: "collectLPFees" }, null, 2), data: { txHash, _tradeCapture: { type: "reward", chain: "0g", status: "executed", walletAddress: wallet.address, signature: txHash, instrumentKey: `0g:${addr}`, meta: { action: "collectLPFees", token: addr } } } };
  },

  // ── Reward (mutating) ─────────────────────────────────────────

  "slop.reward.claim": async (p) => {
    const addr = requireTokenAddr(p);
    if (typeof addr !== "string") return addr;

    await validateOfficialToken(addr);
    const wallet = requireEvmWallet();
    const walletClient = getSigningClient(wallet.privateKey as Hex);

    const txHash = await walletClient.writeContract({
      address: addr,
      abi: SLOP_TOKEN_ABI,
      functionName: "claimCreatorReward",
    });

    return { success: true, output: JSON.stringify({ txHash, token: addr, action: "claimCreatorReward" }, null, 2), data: { txHash, _tradeCapture: { type: "reward", chain: "0g", status: "executed", walletAddress: wallet.address, signature: txHash, instrumentKey: `0g:${addr}`, meta: { action: "claimCreatorReward", token: addr } } } };
  },
};
