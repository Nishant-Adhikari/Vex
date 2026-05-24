/**
 * Solana/Jupiter core handlers — prices, tokens, swap.
 */

import {
  searchJupiterTokens,
  getJupiterTokensByCategory,
  getJupiterTokensByTag,
  getJupiterRecentTokens,
} from "@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import type {
  JupiterTokenCategory,
  JupiterTokenTag,
  JupiterTokenInterval,
} from "@tools/solana-ecosystem/jupiter/jupiter-tokens/types.js";
import { getJupiterPricesByMint } from "@tools/solana-ecosystem/jupiter/jupiter-prices/service.js";
import {
  getJupiterSwapQuote,
  executeJupiterSwap,
} from "@tools/solana-ecosystem/jupiter/jupiter-swaps/service.js";
import { classifySolanaSwap } from "@tools/solana-ecosystem/shared/swap-classify.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { walletAddressesEqual } from "@tools/wallet/inventory.js";
import { VexError, ErrorCodes } from "../../../../../errors.js";
import { resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

// ── Shared helpers (exported for predict + lend handlers) ───────

export function walletAddress(p: Record<string, unknown>, ctx: ProtocolExecutionContext): string {
  const explicit = str(p, "address");
  if (ctx.walletResolution.source === "session") {
    // Session authority: the selected Solana wallet is the only valid owner.
    // An explicit (renderer/LLM-supplied) address that differs is rejected — it
    // must never override session scope.
    const selected = resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "solana");
    if (explicit && !walletAddressesEqual("solana", explicit, selected)) {
      throw new VexError(
        ErrorCodes.WALLET_SCOPE_MISMATCH,
        "The provided address does not match the session's selected Solana wallet.",
      );
    }
    return selected;
  }
  // source:"default" (CLI/MCP) — explicit override preserved; else the primary.
  return explicit || resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "solana");
}

export function walletSecret(ctx: ProtocolExecutionContext): Uint8Array {
  const signer = resolveSigningWallet(ctx.walletResolution, ctx.walletPolicy, "solana");
  if (signer.family !== "solana") {
    throw new VexError(ErrorCodes.WALLET_SCOPE_MISMATCH, "Resolved wallet family mismatch (expected solana).");
  }
  return signer.secretKey;
}

// ── Category routing for tokens.trending ─────────────────────────

const CATEGORY_MAP: Record<string, JupiterTokenCategory> = {
  toptrending: "toptrending",
  toptraded: "toptraded",
  toporganicscore: "toporganicscore",
};
const TAG_MAP: Record<string, JupiterTokenTag> = {
  lst: "lst",
  verified: "verified",
};

// ── Handler map ──────────────────────────────────────────────────

export const CORE_HANDLERS: Record<string, ProtocolHandler> = {
  // Core — prices
  "solana.prices": async (p) => {
    const mints = str(p, "mints").split(",").map(s => s.trim()).filter(Boolean);
    if (mints.length === 0) return fail("Missing required parameter: mints");
    const prices = await getJupiterPricesByMint(mints);
    return ok(prices);
  },

  // Core — token search
  "solana.tokens.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required parameter: query");
    return ok(await searchJupiterTokens(q));
  },

  // Core — token trending (routes to category, recent, or tag)
  "solana.tokens.trending": async (p) => {
    const category = str(p, "category") || "toptrending";
    const interval = (str(p, "interval") || "1h") as JupiterTokenInterval;
    const limit = num(p, "limit") ?? 20;

    if (category === "recent") {
      return ok(await getJupiterRecentTokens());
    }
    if (category in TAG_MAP) {
      return ok(await getJupiterTokensByTag(TAG_MAP[category]));
    }
    const jupiterCategory = CATEGORY_MAP[category] ?? "toptrending";
    return ok(await getJupiterTokensByCategory({ category: jupiterCategory, interval, limit }));
  },

  // Swap
  "solana.swap.quote": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amount");
    if (!input || !output || amount == null) return fail("Missing required: inputToken, outputToken, amount");
    const { quote } = await getJupiterSwapQuote(input, output, amount, { slippageBps: num(p, "slippageBps") });
    return ok(quote);
  },
  "solana.swap.execute": async (p, ctx) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amount");
    if (!input || !output || amount == null) return fail("Missing required: inputToken, outputToken, amount");
    // Session signing wallet (5D-protocols p2) — execute has no preview path.
    let signer: ChainWallet;
    try {
      signer = resolveSigningWallet(ctx.walletResolution, ctx.walletPolicy, "solana");
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    if (signer.family !== "solana") return fail("Resolved wallet family mismatch.");
    const result = await executeJupiterSwap(input, output, amount, signer.secretKey, { slippageBps: num(p, "slippageBps") });
    const cls = classifySolanaSwap(result.inputToken.address, result.outputToken.address);
    const hasExactUsdValue = result.order.inUsdValue != null || result.order.outUsdValue != null;

    // Side-aware unitPriceUsd (best-effort, from human-readable amounts)
    let unitPriceUsd: string | undefined;
    if (cls.tradeSide === "buy" && result.order.inUsdValue != null) {
      const outputUi = parseFloat(result.outputAmount);
      if (outputUi > 0) unitPriceUsd = String(result.order.inUsdValue / outputUi);
    } else if (cls.tradeSide === "sell" && result.order.outUsdValue != null) {
      const inputUi = parseFloat(result.inputAmount);
      if (inputUi > 0) unitPriceUsd = String(result.order.outUsdValue / inputUi);
    }

    // Benchmark-native: SOL only when SOL is one leg
    const inputIsSol = result.inputToken.address === SOL_MINT;
    const outputIsSol = result.outputToken.address === SOL_MINT;
    const hasSolLeg = inputIsSol || outputIsSol;

    // Settlement: the non-instrument (quote) leg
    let settlementAssetKey: string | undefined;
    if (inputIsSol && cls.tradeSide === "buy") settlementAssetKey = "SOL";
    else if (outputIsSol && cls.tradeSide === "sell") settlementAssetKey = "SOL";
    else if (cls.tradeSide === "buy") settlementAssetKey = result.inputToken.symbol;
    else if (cls.tradeSide === "sell") settlementAssetKey = result.outputToken.symbol;

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "swap", chain: "solana", status: "executed",
          inputToken: result.inputToken.symbol, outputToken: result.outputToken.symbol,
          inputTokenAddress: result.inputToken.address, outputTokenAddress: result.outputToken.address,
          inputAmount: result.inputAmountRaw, outputAmount: result.outputAmountRaw,
          signature: result.signature, walletAddress: signer.address,
          tradeSide: cls.tradeSide, instrumentKey: `solana:${cls.instrumentMint}`,
          inputValueUsd: result.order.inUsdValue != null ? String(result.order.inUsdValue) : undefined,
          outputValueUsd: result.order.outUsdValue != null ? String(result.order.outUsdValue) : undefined,
          unitPriceUsd,
          valuationSource: hasExactUsdValue ? "jupiter_exact" : "none",
          benchmarkAssetKey: hasSolLeg ? "SOL" : undefined,
          settlementAssetKey,
          inputValueNative: inputIsSol ? result.inputAmount : undefined,
          outputValueNative: outputIsSol ? result.outputAmount : undefined,
          meta: { inputAmountUi: result.inputAmount, outputAmountUi: result.outputAmount, ...cls.meta },
        },
      },
    };
  },
};
