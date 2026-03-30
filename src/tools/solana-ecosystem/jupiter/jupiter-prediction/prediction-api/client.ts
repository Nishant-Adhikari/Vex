/**
 * Low-level Jupiter Prediction client.
 * Source-of-truth for indexed Prediction HTTP endpoints.
 */

import { fetchJson } from "../../../../../utils/http.js";
import { JUPITER_PREDICTION_API_BASE_URL } from "../constants.js";
import type {
  JupiterPredictionClaimPositionRequest,
  JupiterPredictionClaimPositionResponse,
  JupiterPredictionCloseAllPositionsRequest,
  JupiterPredictionCloseAllPositionsResponse,
  JupiterPredictionClosePositionRequest,
  JupiterPredictionCreateOrderRequest,
  JupiterPredictionCreateOrderResponse,
  JupiterPredictionEventMarketParams,
  JupiterPredictionEventMarketResponse,
  JupiterPredictionEventMarketsParams,
  JupiterPredictionEventMarketsResponse,
  JupiterPredictionEventsParams,
  JupiterPredictionEventsResponse,
  JupiterPredictionGetEventParams,
  JupiterPredictionHistoryParams,
  JupiterPredictionHistoryResponse,
  JupiterPredictionLeaderboardsParams,
  JupiterPredictionLeaderboardsResponse,
  JupiterPredictionMarketParams,
  JupiterPredictionMarketResponse,
  JupiterPredictionOrderbookResponse,
  JupiterPredictionOrderParams,
  JupiterPredictionOrderResponse,
  JupiterPredictionOrdersParams,
  JupiterPredictionOrdersResponse,
  JupiterPredictionOrderStatusResponse,
  JupiterPredictionPnlHistoryParams,
  JupiterPredictionPnlHistoryResponse,
  JupiterPredictionPositionParams,
  JupiterPredictionPositionResponse,
  JupiterPredictionPositionsParams,
  JupiterPredictionPositionsResponse,
  JupiterPredictionProfileParams,
  JupiterPredictionProfileResponse,
  JupiterPredictionSearchEventsParams,
  JupiterPredictionSearchEventsResponse,
  JupiterPredictionSuggestedEventsParams,
  JupiterPredictionSuggestedEventsResponse,
  JupiterPredictionTradesResponse,
  JupiterPredictionTradingStatusResponse,
  JupiterPredictionVaultInfoResponse,
} from "./types.js";
import {
  getJupiterPredictionHeaders,
  requireJupiterPredictionApiKey,
  validateJupiterPredictionClaimPositionRequest,
  validateJupiterPredictionCloseAllPositionsRequest,
  validateJupiterPredictionClosePositionRequest,
  validateJupiterPredictionCreateOrderRequest,
  validateJupiterPredictionEventMarketParams,
  validateJupiterPredictionEventMarketsParams,
  validateJupiterPredictionEventsParams,
  validateJupiterPredictionGetEventParams,
  validateJupiterPredictionHistoryParams,
  validateJupiterPredictionLeaderboardsParams,
  validateJupiterPredictionMarketParams,
  validateJupiterPredictionOrderParams,
  validateJupiterPredictionOrdersParams,
  validateJupiterPredictionPnlHistoryParams,
  validateJupiterPredictionPositionParams,
  validateJupiterPredictionPositionsParams,
  validateJupiterPredictionProfileParams,
  validateJupiterPredictionSearchEventsParams,
  validateJupiterPredictionSuggestedEventsParams,
} from "./validation.js";

function toQueryString(query: Record<string, string | undefined>): string {
  const defined = Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return new URLSearchParams(defined).toString();
}

function withQuery(path: string, query: Record<string, string | undefined>): string {
  const qs = toQueryString(query);
  return qs ? `${JUPITER_PREDICTION_API_BASE_URL}${path}?${qs}` : `${JUPITER_PREDICTION_API_BASE_URL}${path}`;
}

export async function jupiterPredictionEvents(
  params: JupiterPredictionEventsParams = {},
): Promise<JupiterPredictionEventsResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionEventsParams(params);

  return fetchJson<JupiterPredictionEventsResponse>(
    withQuery("/events", {
      provider: validated.provider,
      includeMarkets: validated.includeMarkets != null ? String(validated.includeMarkets) : undefined,
      start: validated.start != null ? String(validated.start) : undefined,
      end: validated.end != null ? String(validated.end) : undefined,
      category: validated.category,
      subcategory: typeof validated.subcategory === "string" ? validated.subcategory : undefined,
      sortBy: validated.sortBy,
      sortDirection: validated.sortDirection,
      filter: validated.filter,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionSearchEvents(
  params: JupiterPredictionSearchEventsParams,
): Promise<JupiterPredictionSearchEventsResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionSearchEventsParams(params);

  return fetchJson<JupiterPredictionSearchEventsResponse>(
    withQuery("/events/search", {
      provider: validated.provider,
      query: validated.query,
      limit: validated.limit != null ? String(validated.limit) : undefined,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionEvent(
  params: JupiterPredictionGetEventParams,
): Promise<JupiterPredictionEventsResponse["data"][number]> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionGetEventParams(params);

  return fetchJson<JupiterPredictionEventsResponse["data"][number]>(
    withQuery(`/events/${validated.eventId}`, {
      includeMarkets: validated.includeMarkets != null ? String(validated.includeMarkets) : undefined,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionSuggestedEvents(
  params: JupiterPredictionSuggestedEventsParams,
): Promise<JupiterPredictionSuggestedEventsResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionSuggestedEventsParams(params);

  return fetchJson<JupiterPredictionSuggestedEventsResponse>(
    withQuery(`/events/suggested/${validated.pubkey}`, {
      provider: validated.provider,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionEventMarkets(
  params: JupiterPredictionEventMarketsParams,
): Promise<JupiterPredictionEventMarketsResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionEventMarketsParams(params);

  return fetchJson<JupiterPredictionEventMarketsResponse>(
    withQuery(`/events/${validated.eventId}/markets`, {
      start: validated.start != null ? String(validated.start) : undefined,
      end: validated.end != null ? String(validated.end) : undefined,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionEventMarket(
  params: JupiterPredictionEventMarketParams,
): Promise<JupiterPredictionEventMarketResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionEventMarketParams(params);

  return fetchJson<JupiterPredictionEventMarketResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/events/${validated.eventId}/markets/${validated.marketId}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionMarket(
  params: JupiterPredictionMarketParams,
): Promise<JupiterPredictionMarketResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionMarketParams(params);

  return fetchJson<JupiterPredictionMarketResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/markets/${validated.marketId}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionOrderbook(
  params: JupiterPredictionMarketParams,
): Promise<JupiterPredictionOrderbookResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionMarketParams(params);

  return fetchJson<JupiterPredictionOrderbookResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/orderbook/${validated.marketId}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionTradingStatus(): Promise<JupiterPredictionTradingStatusResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionTradingStatusResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/trading-status`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionOrders(
  params: JupiterPredictionOrdersParams = {},
): Promise<JupiterPredictionOrdersResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionOrdersParams(params);

  return fetchJson<JupiterPredictionOrdersResponse>(
    withQuery("/orders", {
      start: validated.start != null ? String(validated.start) : undefined,
      end: validated.end != null ? String(validated.end) : undefined,
      ownerPubkey: validated.ownerPubkey,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionOrder(
  params: JupiterPredictionOrderParams,
): Promise<JupiterPredictionOrderResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionOrderParams(params);

  return fetchJson<JupiterPredictionOrderResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/orders/${validated.orderPubkey}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionOrderStatus(
  params: JupiterPredictionOrderParams,
): Promise<JupiterPredictionOrderStatusResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionOrderParams(params);

  return fetchJson<JupiterPredictionOrderStatusResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/orders/status/${validated.orderPubkey}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionCreateOrder(
  request: JupiterPredictionCreateOrderRequest,
): Promise<JupiterPredictionCreateOrderResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionCreateOrderResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/orders`,
    {
      method: "POST",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionCreateOrderRequest(request)),
    },
  );
}

export async function jupiterPredictionPositions(
  params: JupiterPredictionPositionsParams = {},
): Promise<JupiterPredictionPositionsResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionPositionsParams(params);

  return fetchJson<JupiterPredictionPositionsResponse>(
    withQuery("/positions", {
      start: validated.start != null ? String(validated.start) : undefined,
      end: validated.end != null ? String(validated.end) : undefined,
      ownerPubkey: validated.ownerPubkey,
      marketPubkey: validated.marketPubkey,
      marketId: validated.marketId,
      isYes: validated.isYes != null ? String(validated.isYes) : undefined,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionPosition(
  params: JupiterPredictionPositionParams,
): Promise<JupiterPredictionPositionResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionPositionParams(params);

  return fetchJson<JupiterPredictionPositionResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions/${validated.positionPubkey}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionClosePosition(
  positionPubkey: string,
  request: JupiterPredictionClosePositionRequest,
): Promise<JupiterPredictionCreateOrderResponse> {
  requireJupiterPredictionApiKey();
  const validatedPosition = validateJupiterPredictionPositionParams({ positionPubkey });

  return fetchJson<JupiterPredictionCreateOrderResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions/${validatedPosition.positionPubkey}`,
    {
      method: "DELETE",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionClosePositionRequest(request)),
    },
  );
}

export async function jupiterPredictionCloseAllPositions(
  request: JupiterPredictionCloseAllPositionsRequest,
): Promise<JupiterPredictionCloseAllPositionsResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionCloseAllPositionsResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions`,
    {
      method: "DELETE",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionCloseAllPositionsRequest(request)),
    },
  );
}

export async function jupiterPredictionClaimPosition(
  positionPubkey: string,
  request: JupiterPredictionClaimPositionRequest,
): Promise<JupiterPredictionClaimPositionResponse> {
  requireJupiterPredictionApiKey();
  const validatedPosition = validateJupiterPredictionPositionParams({ positionPubkey });

  return fetchJson<JupiterPredictionClaimPositionResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions/${validatedPosition.positionPubkey}/claim`,
    {
      method: "POST",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionClaimPositionRequest(request)),
    },
  );
}

export async function jupiterPredictionHistory(
  params: JupiterPredictionHistoryParams = {},
): Promise<JupiterPredictionHistoryResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionHistoryParams(params);

  return fetchJson<JupiterPredictionHistoryResponse>(
    withQuery("/history", {
      start: validated.start != null ? String(validated.start) : undefined,
      end: validated.end != null ? String(validated.end) : undefined,
      ownerPubkey: validated.ownerPubkey,
      id: validated.id != null ? String(validated.id) : undefined,
      positionPubkey: validated.positionPubkey,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionProfile(
  params: JupiterPredictionProfileParams,
): Promise<JupiterPredictionProfileResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionProfileParams(params);

  return fetchJson<JupiterPredictionProfileResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/profiles/${validated.ownerPubkey}`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionPnlHistory(
  params: JupiterPredictionPnlHistoryParams,
): Promise<JupiterPredictionPnlHistoryResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionPnlHistoryParams(params);

  return fetchJson<JupiterPredictionPnlHistoryResponse>(
    withQuery(`/profiles/${validated.ownerPubkey}/pnl-history`, {
      interval: validated.interval,
      count: validated.count != null ? String(validated.count) : undefined,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionTrades(): Promise<JupiterPredictionTradesResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionTradesResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/trades`,
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionLeaderboards(
  params: JupiterPredictionLeaderboardsParams = {},
): Promise<JupiterPredictionLeaderboardsResponse> {
  requireJupiterPredictionApiKey();
  const validated = validateJupiterPredictionLeaderboardsParams(params);

  return fetchJson<JupiterPredictionLeaderboardsResponse>(
    withQuery("/leaderboards", {
      period: validated.period,
      limit: validated.limit != null ? String(validated.limit) : undefined,
      metric: validated.metric,
    }),
    { headers: getJupiterPredictionHeaders() },
  );
}

export async function jupiterPredictionVaultInfo(): Promise<JupiterPredictionVaultInfoResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionVaultInfoResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/vault-info`,
    { headers: getJupiterPredictionHeaders() },
  );
}
