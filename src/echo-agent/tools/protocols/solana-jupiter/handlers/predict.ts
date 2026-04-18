/**
 * Solana/Jupiter prediction market handlers.
 */

import {
  getJupiterPredictionEvents,
  searchJupiterPredictionEvents,
  getJupiterPredictionMarket,
  getJupiterPredictionEvent,
  getJupiterPredictionPosition,
  getJupiterPredictionPositions,
  getJupiterPredictionHistory,
  executeJupiterPredictionCreateOrder,
  executeJupiterPredictionClosePosition,
  executeJupiterPredictionCloseAllPositions,
  executeJupiterPredictionClaimPosition,
} from "@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js";
import { JUPITER_PREDICTION_USDC_MINT } from "@tools/solana-ecosystem/jupiter/jupiter-prediction/constants.js";

import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail, enumField } from "../../handler-helpers.js";
import { walletAddress, walletSecret } from "./core.js";

// ── SDK enum mirrors ──────────────────────────────────────────────
// Source: `JupiterPredictionCategory` + `JupiterPredictionFilter` in
// `@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/base.ts`.
const PREDICT_CATEGORY = [
  "all", "crypto", "sports", "politics", "esports", "culture", "economics", "tech",
] as const;
const PREDICT_FILTER = ["new", "live", "trending"] as const;

// ── Handler map ──────────────────────────────────────────────────

export const PREDICT_HANDLERS: Record<string, ProtocolHandler> = {
  "solana.predict.events": async (p) => {
    const result = await getJupiterPredictionEvents({
      category: enumField(p, "category", PREDICT_CATEGORY),
      filter: enumField(p, "filter", PREDICT_FILTER),
      includeMarkets: true,
    });
    return ok(result);
  },
  "solana.predict.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required: query");
    return ok(await searchJupiterPredictionEvents({ query: q }));
  },
  "solana.predict.market": async (p) => {
    const id = str(p, "marketId");
    if (!id) return fail("Missing required: marketId");
    return ok(await getJupiterPredictionMarket(id));
  },
  "solana.predict.positions": async (p) => ok(await getJupiterPredictionPositions({ ownerPubkey: walletAddress(p) })),
  "solana.predict.history": async (p) => {
    const start = num(p, "offset") ?? 0;
    const limit = num(p, "limit") ?? 10;
    return ok(await getJupiterPredictionHistory({
      ownerPubkey: walletAddress(p),
      start,
      end: start + limit,
    }));
  },
  "solana.predict.buy": async (p) => {
    const marketId = str(p, "marketId"), side = str(p, "side");
    const amount = num(p, "amountUsdc");
    if (!marketId || !side || amount == null) return fail("Missing required: marketId, side, amountUsdc");
    const normalizedSide = side.toLowerCase();
    if (normalizedSide !== "yes" && normalizedSide !== "no") return fail('side must be "yes" or "no"');
    const isYes = normalizedSide === "yes";
    const depositAmount = Math.round(amount * 1_000_000);
    const result = await executeJupiterPredictionCreateOrder(walletSecret(), {
      marketId, isYes, isBuy: true, depositAmount, depositMint: JUPITER_PREDICTION_USDC_MINT,
    });
    const positionPubkey = result.raw.order.positionPubkey;
    const order = result.raw.order;
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        positionPubkey,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "open",
          walletAddress: walletAddress(p), tradeSide: "buy",
          positionKey: positionPubkey, instrumentKey: `solana:predict:${marketId}:${normalizedSide}`,
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
          settlementAssetKey: "USDC",
          meta: { marketId, side: normalizedSide, sizeUsd: order.newSizeUsd, payoutUsd: order.newPayoutUsd, contracts: order.newContracts },
        },
      },
    };
  },
  "solana.predict.sell": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await executeJupiterPredictionClosePosition(walletSecret(), pk);
    const order = result.raw.order;
    const outcome = order.isYes ? "yes" : "no";
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "closed",
          walletAddress: walletAddress(p), tradeSide: "sell",
          positionKey: pk,
          instrumentKey: `solana:predict:${order.marketId}:${outcome}`,
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
          settlementAssetKey: "USDC",
          meta: { positionPubkey: pk, marketId: order.marketId, side: outcome, sizeUsd: order.newSizeUsd, payoutUsd: order.newPayoutUsd, contracts: order.contracts },
        },
      },
    };
  },
  "solana.predict.claim": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await executeJupiterPredictionClaimPosition(walletSecret(), pk);
    const pos = result.raw.position;
    const outcome = pos.isYes ? "yes" : "no";
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "claimed",
          walletAddress: walletAddress(p), positionKey: pk,
          outputValueUsd: pos.payoutAmountUsd,
          valuationSource: "prediction_exact",
          settlementAssetKey: "USDC",
          // No instrumentKey — claim response has marketPubkey (account address), not marketId.
          // Downstream matches via positionKey from the buy capture.
          meta: { positionPubkey: pk, side: outcome, payoutAmountUsd: pos.payoutAmountUsd, contracts: pos.contracts },
        },
      },
    };
  },
  "solana.predict.closeAll": async (p) => {
    const result = await executeJupiterPredictionCloseAllPositions(walletSecret());
    const wallet = walletAddress(p);

    const captureItems = result.results.map(item => {
      let pk: string | undefined;
      let marketId: string | undefined;
      let outcome: string | undefined;
      let itemValuation: Record<string, string | undefined> = {};

      let contracts: string | undefined;

      if ("order" in item.raw) {
        const order = item.raw.order;
        pk = order.positionPubkey;
        marketId = order.marketId;
        outcome = order.isYes ? "yes" : "no";
        contracts = order.contracts;
        itemValuation = {
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
        };
      } else if ("position" in item.raw) {
        const pos = item.raw.position;
        pk = pos.positionPubkey;
        outcome = pos.isYes ? "yes" : "no";
        contracts = pos.contracts;
        itemValuation = {
          outputValueUsd: pos.payoutAmountUsd,
          valuationSource: "prediction_exact",
        };
      }

      return {
        type: "prediction" as const, chain: "solana" as const,
        status: item.kind === "claim" ? "claimed" as const : "closed" as const,
        walletAddress: wallet, tradeSide: "sell" as const,
        signature: item.signature,
        positionKey: pk,
        instrumentKey: marketId && outcome ? `solana:predict:${marketId}:${outcome}` : undefined,
        settlementAssetKey: "USDC",
        ...itemValuation,
        meta: { kind: item.kind, positionPubkey: pk, outcome, contracts },
      };
    });

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "closed",
          walletAddress: wallet, tradeSide: "sell",
          signature: result.results[0]?.signature,
          meta: { action: "closeAll", count: result.results.length },
        },
        _tradeCaptureItems: captureItems,
      },
    };
  },
  "solana.predict.event": async (p) => {
    const id = str(p, "eventId");
    if (!id) return fail("Missing required: eventId");
    return ok(await getJupiterPredictionEvent({ eventId: id, includeMarkets: true }));
  },
  "solana.predict.position": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    return ok(await getJupiterPredictionPosition(pk));
  },
};
