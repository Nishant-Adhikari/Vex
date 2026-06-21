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
import { walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

// ── SDK enum mirrors ──────────────────────────────────────────────
// Source: `JupiterPredictionCategory` + `JupiterPredictionFilter` in
// `@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/base.ts`.
const PREDICT_CATEGORY = [
  "all", "crypto", "sports", "politics", "esports", "culture", "economics", "tech",
] as const;
const PREDICT_FILTER = ["new", "live", "trending"] as const;

// ── Compact-JSON projector (P1-11) ───────────────────────────────
// Events and positions are returned verbatim from the SDK and carry heavy,
// agent-irrelevant payload: imageUrl / rulesPdf blobs, marketResultPubkey
// account addresses, and event-metadata noise (slug/series/closeTime/imageUrl).
// `toPredictView` projects each item down to the fields the agent reasons over.
// It is intentionally narrow and structural: it discriminates a position (has a
// top-level `pubkey`) from an event (has `eventId` but no `pubkey`) and curates
// each. Unknown / non-object input is returned untouched so the handler never
// turns a real SDK shape into `null` silently.
//
// NOT advertised as guaranteed output (verified against manifest + discovery):
// imageUrl, rulesPdf, marketResultPubkey, event metadata.{slug,series,closeTime,imageUrl}.

/** Narrow an unknown to a plain object (excludes null + arrays). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep only the listed keys that are actually present on the source object. */
function pick(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

/** Curate event metadata down to title/subtitle/eventId (drop slug/series/closeTime/imageUrl). */
function projectEventMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) return undefined;
  return pick(metadata, ["eventId", "title", "subtitle"]);
}

/** Curate market metadata, keeping title/subtitle/eventId. */
function projectMarketMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) return undefined;
  return pick(metadata, ["marketId", "eventId", "title", "subtitle", "status", "result"]);
}

/**
 * Curate a single market: keep marketId/status/result/timings/pricing and the
 * curated metadata; drop imageUrl + marketResultPubkey.
 */
function projectMarket(market: unknown): unknown {
  if (!isRecord(market)) return market;
  const view = pick(market, [
    "marketId", "status", "result", "openTime", "closeTime", "resolveAt", "pricing",
  ]);
  const metadata = projectMarketMetadata(market.metadata);
  if (metadata !== undefined) view.metadata = metadata;
  return view;
}

/** Curate a single event: keep eventId/category/volumeUsd + curated metadata + curated markets. */
function projectEvent(event: Record<string, unknown>): Record<string, unknown> {
  const view = pick(event, ["eventId", "category", "volumeUsd"]);
  const metadata = projectEventMetadata(event.metadata);
  if (metadata !== undefined) view.metadata = metadata;
  if (Array.isArray(event.markets)) view.markets = event.markets.map(projectMarket);
  return view;
}

/** Curate a single position: keep exposure/PnL/claim fields + curated metadata; drop noise. */
function projectPosition(position: Record<string, unknown>): Record<string, unknown> {
  const view = pick(position, [
    "pubkey", "owner", "contracts", "sizeUsd", "valueUsd", "avgPriceUsd",
    "markPriceUsd", "pnlUsd", "claimed", "payoutUsd", "eventId",
  ]);
  const eventMetadata = projectEventMetadata(position.eventMetadata);
  if (eventMetadata !== undefined) view.eventMetadata = eventMetadata;
  const marketMetadata = projectMarketMetadata(position.marketMetadata);
  if (marketMetadata !== undefined) view.marketMetadata = marketMetadata;
  return view;
}

/**
 * Project a prediction event or position to its agent-facing view.
 * Returns the input untouched for non-object values so it is safe to map over
 * arrays of mixed/unknown shape without producing `null` holes.
 */
function toPredictView(item: unknown): unknown {
  if (!isRecord(item)) return item;
  // A position carries a top-level `pubkey`; an event never does.
  if (typeof item.pubkey === "string") return projectPosition(item);
  if (typeof item.eventId === "string") return projectEvent(item);
  return item;
}

// ── Handler map ──────────────────────────────────────────────────

export const PREDICT_HANDLERS: Record<string, ProtocolHandler> = {
  "solana.predict.events": async (p) => {
    // Pagination: manifest exposes limit/offset; the SDK takes start/end
    // (mirrors solana.predict.history). Unbounded list → always paginate.
    // Clamp negatives to 0 (Math.max) so a negative limit/offset can never
    // translate into an invalid/negative start/end window for the SDK.
    const start = Math.max(0, num(p, "offset") ?? 0);
    const limit = Math.max(0, num(p, "limit") ?? 10);
    const result = await getJupiterPredictionEvents({
      category: enumField(p, "category", PREDICT_CATEGORY),
      filter: enumField(p, "filter", PREDICT_FILTER),
      includeMarkets: true,
      start,
      end: start + limit,
    });
    return ok({ ...result, data: result.data.map(toPredictView) });
  },
  "solana.predict.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required: query");
    const result = await searchJupiterPredictionEvents({ query: q });
    return ok({ ...result, data: result.data.map(toPredictView) });
  },
  "solana.predict.market": async (p) => {
    const id = str(p, "marketId");
    if (!id) return fail("Missing required: marketId");
    return ok(await getJupiterPredictionMarket(id));
  },
  "solana.predict.positions": async (p, ctx) => {
    let owner: string;
    try {
      owner = walletAddress(p, ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    // Pagination: manifest exposes limit/offset; the SDK takes start/end
    // (mirrors solana.predict.history). Unbounded list → always paginate.
    // Clamp negatives to 0 (Math.max) so a negative limit/offset can never
    // translate into an invalid/negative start/end window for the SDK.
    const start = Math.max(0, num(p, "offset") ?? 0);
    const limit = Math.max(0, num(p, "limit") ?? 10);
    const result = await getJupiterPredictionPositions({
      ownerPubkey: owner,
      start,
      end: start + limit,
    });
    return ok({ ...result, data: result.data.map(toPredictView) });
  },
  "solana.predict.history": async (p, ctx) => {
    let owner: string;
    try {
      owner = walletAddress(p, ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const start = num(p, "offset") ?? 0;
    const limit = num(p, "limit") ?? 10;
    return ok(await getJupiterPredictionHistory({
      ownerPubkey: owner,
      start,
      end: start + limit,
    }));
  },
  "solana.predict.buy": async (p, ctx) => {
    const marketId = str(p, "marketId"), side = str(p, "side");
    const amount = num(p, "amountUsdc");
    if (!marketId || !side || amount == null) return fail("Missing required: marketId, side, amountUsdc");
    const normalizedSide = side.toLowerCase();
    if (normalizedSide !== "yes" && normalizedSide !== "no") return fail('side must be "yes" or "no"');
    const isYes = normalizedSide === "yes";
    const depositAmount = Math.round(amount * 1_000_000);
    // Resolve owner + signer BEFORE broadcast (5D-protocols p2).
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionCreateOrder(secret, {
      marketId, isYes, isBuy: true, depositAmount, depositMint: JUPITER_PREDICTION_USDC_MINT,
    });
    const positionPubkey = result.raw.order.positionPubkey;
    const order = result.raw.order;
    return {
      success: true,
      // Lean view (P0-2): drop the base64 VersionedTransaction + build internals
      // carried on `result.raw`; the full result + _tradeCapture stay in `data`.
      output: JSON.stringify({
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        positionPubkey,
        marketId,
        side: normalizedSide,
        sizeUsd: order.newSizeUsd,
        payoutUsd: order.newPayoutUsd,
        contracts: order.newContracts,
        avgPriceUsd: order.newAvgPriceUsd,
        costUsd: order.orderCostUsd,
        feeUsd: order.estimatedTotalFeeUsd,
      }, null, 2),
      data: {
        ...result,
        positionPubkey,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "open",
          walletAddress: addr, tradeSide: "buy",
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
  "solana.predict.sell": async (p, ctx) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionClosePosition(secret, pk);
    const order = result.raw.order;
    const outcome = order.isYes ? "yes" : "no";
    return {
      success: true,
      // Lean view (P0-2): drop the base64 tx; full result + _tradeCapture in data.
      output: JSON.stringify({
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        positionPubkey: pk,
        marketId: order.marketId,
        side: outcome,
        sizeUsd: order.newSizeUsd,
        payoutUsd: order.newPayoutUsd,
        contracts: order.contracts,
        avgPriceUsd: order.newAvgPriceUsd,
        costUsd: order.orderCostUsd,
        feeUsd: order.estimatedTotalFeeUsd,
      }, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "closed",
          walletAddress: addr, tradeSide: "sell",
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
  "solana.predict.claim": async (p, ctx) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionClaimPosition(secret, pk);
    const pos = result.raw.position;
    const outcome = pos.isYes ? "yes" : "no";
    return {
      success: true,
      // Lean view (P0-2): drop the base64 tx; full result + _tradeCapture in data.
      output: JSON.stringify({
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        positionPubkey: pk,
        side: outcome,
        payoutAmountUsd: pos.payoutAmountUsd,
        contracts: pos.contracts,
      }, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "claimed",
          walletAddress: addr, positionKey: pk,
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
  "solana.predict.closeAll": async (p, ctx) => {
    // Resolve owner + signer BEFORE broadcast (5D-protocols p2).
    let wallet: string, secret: Uint8Array;
    try {
      wallet = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionCloseAllPositions(secret);

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

    // Lean view (P0-2): closeAll otherwise DOUBLE-embeds every position's base64
    // tx (result.raw + each results[].raw). Summarise from the captured items;
    // the full result + _tradeCapture(+Items) stay in the (dropped) `data`.
    const closed = captureItems.map((c) => ({
      kind: c.meta.kind,
      signature: c.signature,
      positionPubkey: c.meta.positionPubkey,
      outcome: c.meta.outcome,
      contracts: c.meta.contracts,
    }));
    return {
      success: true,
      output: JSON.stringify({ count: result.results.length, closed }, null, 2),
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
    return ok(toPredictView(await getJupiterPredictionEvent({ eventId: id, includeMarkets: true })));
  },
  "solana.predict.position": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    return ok(toPredictView(await getJupiterPredictionPosition(pk)));
  },
};
