/**
 * High-level Jupiter Prediction service.
 * Preserves full wire responses and adds signing helpers for transaction-returning endpoints.
 */

import { Keypair } from "@solana/web3.js";
import { EchoError, ErrorCodes } from "../../../../../errors.js";
import { signAndSendVersionedTx } from "../../../shared/solana-transaction.js";
import { solanaExplorerUrl } from "../../../shared/solana-validation.js";
import {
  jupiterPredictionClaimPosition,
  jupiterPredictionCloseAllPositions,
  jupiterPredictionClosePosition,
  jupiterPredictionCreateOrder,
  jupiterPredictionEvent,
  jupiterPredictionEventMarket,
  jupiterPredictionEventMarkets,
  jupiterPredictionEvents,
  jupiterPredictionHistory,
  jupiterPredictionLeaderboards,
  jupiterPredictionMarket,
  jupiterPredictionOrder,
  jupiterPredictionOrderbook,
  jupiterPredictionOrders,
  jupiterPredictionOrderStatus,
  jupiterPredictionPnlHistory,
  jupiterPredictionPosition,
  jupiterPredictionPositions,
  jupiterPredictionProfile,
  jupiterPredictionSearchEvents,
  jupiterPredictionSuggestedEvents,
  jupiterPredictionTrades,
  jupiterPredictionTradingStatus,
  jupiterPredictionVaultInfo,
} from "./client.js";
import type {
  JupiterPredictionClaimPositionResponse,
  JupiterPredictionCloseAllExecutionItem,
  JupiterPredictionCloseAllExecutionResult,
  JupiterPredictionCloseAllPositionsItem,
  JupiterPredictionCloseAllPositionsResponse,
  JupiterPredictionCloseAllPositionsRequest,
  JupiterPredictionClaimPositionRequest,
  JupiterPredictionClosePositionRequest,
  JupiterPredictionCreateOrderRequest,
  JupiterPredictionCreateOrderResponse,
  JupiterPredictionEventMarketResponse,
  JupiterPredictionEventMarketsParams,
  JupiterPredictionEventMarketsResponse,
  JupiterPredictionEventsParams,
  JupiterPredictionEventsResponse,
  JupiterPredictionExecutionResult,
  JupiterPredictionGetEventParams,
  JupiterPredictionHistoryParams,
  JupiterPredictionHistoryResponse,
  JupiterPredictionLeaderboardsParams,
  JupiterPredictionLeaderboardsResponse,
  JupiterPredictionMarketResponse,
  JupiterPredictionOrderbookResponse,
  JupiterPredictionOrderResponse,
  JupiterPredictionOrdersParams,
  JupiterPredictionOrdersResponse,
  JupiterPredictionOrderStatusResponse,
  JupiterPredictionPnlHistoryParams,
  JupiterPredictionPnlHistoryResponse,
  JupiterPredictionPositionResponse,
  JupiterPredictionPositionsParams,
  JupiterPredictionPositionsResponse,
  JupiterPredictionProfileResponse,
  JupiterPredictionSearchEventsParams,
  JupiterPredictionSearchEventsResponse,
  JupiterPredictionSuggestedEventsParams,
  JupiterPredictionSuggestedEventsResponse,
  JupiterPredictionTradesResponse,
  JupiterPredictionTradingStatusResponse,
  JupiterPredictionVaultInfoResponse,
} from "./types.js";

function requireTransaction(
  transaction: string | null | undefined,
  feature: string,
): string {
  if (!transaction) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `${feature} did not return an executable transaction.`,
    );
  }
  return transaction;
}

function itemKind(item: JupiterPredictionCloseAllPositionsItem): "order" | "claim" {
  return "order" in item ? "order" : "claim";
}

async function executePredictionTransaction<T extends { transaction: string | null | undefined }>(
  signer: Keypair,
  raw: T,
  feature: string,
): Promise<JupiterPredictionExecutionResult<T>> {
  const signature = await signAndSendVersionedTx(requireTransaction(raw.transaction, feature), [signer]);

  return {
    signature,
    explorerUrl: solanaExplorerUrl(signature),
    signer: signer.publicKey.toBase58(),
    raw,
  };
}

export async function getJupiterPredictionEvents(
  params: JupiterPredictionEventsParams = {},
): Promise<JupiterPredictionEventsResponse> {
  return jupiterPredictionEvents(params);
}

export async function searchJupiterPredictionEvents(
  params: JupiterPredictionSearchEventsParams,
): Promise<JupiterPredictionSearchEventsResponse> {
  return jupiterPredictionSearchEvents(params);
}

export async function getJupiterPredictionEvent(
  params: JupiterPredictionGetEventParams,
): Promise<JupiterPredictionEventsResponse["data"][number]> {
  return jupiterPredictionEvent(params);
}

export async function getJupiterPredictionSuggestedEvents(
  params: JupiterPredictionSuggestedEventsParams,
): Promise<JupiterPredictionSuggestedEventsResponse> {
  return jupiterPredictionSuggestedEvents(params);
}

export async function getJupiterPredictionEventMarkets(
  eventId: string,
  params: Pick<JupiterPredictionEventMarketsParams, "start" | "end"> = {},
): Promise<JupiterPredictionEventMarketsResponse> {
  return jupiterPredictionEventMarkets({ eventId, ...params });
}

export async function getJupiterPredictionEventMarket(
  eventId: string,
  marketId: string,
): Promise<JupiterPredictionEventMarketResponse> {
  return jupiterPredictionEventMarket({ eventId, marketId });
}

export async function getJupiterPredictionMarket(
  marketId: string,
): Promise<JupiterPredictionMarketResponse> {
  return jupiterPredictionMarket({ marketId });
}

export async function getJupiterPredictionOrderbook(
  marketId: string,
): Promise<JupiterPredictionOrderbookResponse> {
  return jupiterPredictionOrderbook({ marketId });
}

export async function getJupiterPredictionTradingStatus(): Promise<JupiterPredictionTradingStatusResponse> {
  return jupiterPredictionTradingStatus();
}

export async function getJupiterPredictionOrders(
  params: JupiterPredictionOrdersParams = {},
): Promise<JupiterPredictionOrdersResponse> {
  return jupiterPredictionOrders(params);
}

export async function getJupiterPredictionOrder(
  orderPubkey: string,
): Promise<JupiterPredictionOrderResponse> {
  return jupiterPredictionOrder({ orderPubkey });
}

export async function getJupiterPredictionOrderStatus(
  orderPubkey: string,
): Promise<JupiterPredictionOrderStatusResponse> {
  return jupiterPredictionOrderStatus({ orderPubkey });
}

export async function getJupiterPredictionPositions(
  params: JupiterPredictionPositionsParams = {},
): Promise<JupiterPredictionPositionsResponse> {
  return jupiterPredictionPositions(params);
}

export async function getJupiterPredictionPosition(
  positionPubkey: string,
): Promise<JupiterPredictionPositionResponse> {
  return jupiterPredictionPosition({ positionPubkey });
}

export async function getJupiterPredictionHistory(
  params: JupiterPredictionHistoryParams = {},
): Promise<JupiterPredictionHistoryResponse> {
  return jupiterPredictionHistory(params);
}

export async function getJupiterPredictionProfile(
  ownerPubkey: string,
): Promise<JupiterPredictionProfileResponse> {
  return jupiterPredictionProfile({ ownerPubkey });
}

export async function getJupiterPredictionPnlHistory(
  params: JupiterPredictionPnlHistoryParams,
): Promise<JupiterPredictionPnlHistoryResponse> {
  return jupiterPredictionPnlHistory(params);
}

export async function getJupiterPredictionTrades(): Promise<JupiterPredictionTradesResponse> {
  return jupiterPredictionTrades();
}

export async function getJupiterPredictionLeaderboards(
  params: JupiterPredictionLeaderboardsParams = {},
): Promise<JupiterPredictionLeaderboardsResponse> {
  return jupiterPredictionLeaderboards(params);
}

export async function getJupiterPredictionVaultInfo(): Promise<JupiterPredictionVaultInfoResponse> {
  return jupiterPredictionVaultInfo();
}

export async function requestJupiterPredictionCreateOrderTransaction(
  request: JupiterPredictionCreateOrderRequest,
): Promise<JupiterPredictionCreateOrderResponse> {
  return jupiterPredictionCreateOrder(request);
}

export async function requestJupiterPredictionClosePositionTransaction(
  positionPubkey: string,
  request: JupiterPredictionClosePositionRequest,
): Promise<JupiterPredictionCreateOrderResponse> {
  return jupiterPredictionClosePosition(positionPubkey, request);
}

export async function requestJupiterPredictionCloseAllPositionsTransactions(
  request: JupiterPredictionCloseAllPositionsRequest,
): Promise<JupiterPredictionCloseAllPositionsResponse> {
  return jupiterPredictionCloseAllPositions(request);
}

export async function requestJupiterPredictionClaimPositionTransaction(
  positionPubkey: string,
  request: JupiterPredictionClaimPositionRequest,
): Promise<JupiterPredictionClaimPositionResponse> {
  return jupiterPredictionClaimPosition(positionPubkey, request);
}

export async function executeJupiterPredictionCreateOrder(
  secretKey: Uint8Array,
  request: Omit<JupiterPredictionCreateOrderRequest, "ownerPubkey">,
): Promise<JupiterPredictionExecutionResult<JupiterPredictionCreateOrderResponse>> {
  const signer = Keypair.fromSecretKey(secretKey);
  const raw = await jupiterPredictionCreateOrder({
    ...request,
    ownerPubkey: signer.publicKey.toBase58(),
  });

  return executePredictionTransaction(signer, raw, "Create order");
}

export async function executeJupiterPredictionClosePosition(
  secretKey: Uint8Array,
  positionPubkey: string,
): Promise<JupiterPredictionExecutionResult<JupiterPredictionCreateOrderResponse>> {
  const signer = Keypair.fromSecretKey(secretKey);
  const raw = await jupiterPredictionClosePosition(positionPubkey, {
    ownerPubkey: signer.publicKey.toBase58(),
  });

  return executePredictionTransaction(signer, raw, "Close position");
}

export async function executeJupiterPredictionCloseAllPositions(
  secretKey: Uint8Array,
): Promise<JupiterPredictionCloseAllExecutionResult> {
  const signer = Keypair.fromSecretKey(secretKey);
  const raw = await jupiterPredictionCloseAllPositions({
    ownerPubkey: signer.publicKey.toBase58(),
  });

  const results: JupiterPredictionCloseAllExecutionItem[] = [];
  for (const item of raw.data) {
    const executed = await executePredictionTransaction(signer, item, "Close all positions");
    results.push({ ...executed, kind: itemKind(item) });
  }

  return {
    signer: signer.publicKey.toBase58(),
    results,
    raw,
  };
}

export async function executeJupiterPredictionClaimPosition(
  secretKey: Uint8Array,
  positionPubkey: string,
): Promise<JupiterPredictionExecutionResult<JupiterPredictionClaimPositionResponse>> {
  const signer = Keypair.fromSecretKey(secretKey);
  const raw = await jupiterPredictionClaimPosition(positionPubkey, {
    ownerPubkey: signer.publicKey.toBase58(),
  });

  return executePredictionTransaction(signer, raw, "Claim position");
}
