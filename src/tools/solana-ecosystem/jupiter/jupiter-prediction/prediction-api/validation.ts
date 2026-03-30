/**
 * Validation and auth helpers for Jupiter Prediction endpoints.
 */

import { EchoError, ErrorCodes } from "../../../../../errors.js";
import {
  requireJupiterApiKey as requireSharedJupiterApiKey,
  resolveJupiterApiKey as resolveSharedJupiterApiKey,
} from "../../../shared/jupiter-auth.js";
import { validateSolanaAddress } from "../../../shared/solana-validation.js";
import type {
  JupiterPredictionCategory,
  JupiterPredictionClaimPositionRequest,
  JupiterPredictionCloseAllPositionsRequest,
  JupiterPredictionClosePositionRequest,
  JupiterPredictionCreateOrderRequest,
  JupiterPredictionEventMarketParams,
  JupiterPredictionEventMarketsParams,
  JupiterPredictionEventsParams,
  JupiterPredictionFilter,
  JupiterPredictionGetEventParams,
  JupiterPredictionHistoryParams,
  JupiterPredictionLeaderboardsParams,
  JupiterPredictionLeaderboardMetric,
  JupiterPredictionLeaderboardPeriod,
  JupiterPredictionMarketParams,
  JupiterPredictionOrderParams,
  JupiterPredictionOrdersParams,
  JupiterPredictionPnlHistoryParams,
  JupiterPredictionPnlInterval,
  JupiterPredictionPositionParams,
  JupiterPredictionPositionsParams,
  JupiterPredictionProfileParams,
  JupiterPredictionProvider,
  JupiterPredictionSearchEventsParams,
  JupiterPredictionSortBy,
  JupiterPredictionSortDirection,
  JupiterPredictionSuggestedEventsParams,
} from "./types.js";

const PREDICTION_PROVIDERS: JupiterPredictionProvider[] = ["kalshi", "polymarket"];
const PREDICTION_CATEGORIES: JupiterPredictionCategory[] = [
  "all",
  "crypto",
  "sports",
  "politics",
  "esports",
  "culture",
  "economics",
  "tech",
];
const PREDICTION_FILTERS: JupiterPredictionFilter[] = ["new", "live", "trending"];
const PREDICTION_SORT_BY: JupiterPredictionSortBy[] = ["volume", "beginAt"];
const PREDICTION_SORT_DIRECTIONS: JupiterPredictionSortDirection[] = ["asc", "desc"];
const PREDICTION_PNL_INTERVALS: JupiterPredictionPnlInterval[] = ["24h", "1w", "1m"];
const PREDICTION_LEADERBOARD_PERIODS: JupiterPredictionLeaderboardPeriod[] = [
  "all_time",
  "weekly",
  "monthly",
];
const PREDICTION_LEADERBOARD_METRICS: JupiterPredictionLeaderboardMetric[] = [
  "pnl",
  "volume",
  "win_rate",
];

function assertNonEmptyString(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `${name} is required.`,
    );
  }
  return trimmed;
}

function assertIntegerInRange(
  name: string,
  value: number,
  min: number,
  max?: number,
): void {
  if (!Number.isInteger(value) || value < min || (max != null && value > max)) {
    const range = max != null ? `between ${min} and ${max}` : `at least ${min}`;
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${value}`,
      `${name} must be an integer ${range}.`,
    );
  }
}

function assertEnumValue<T extends string>(
  name: string,
  value: T,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value)) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `Invalid ${name}: ${value}`,
      `${name} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value;
}

function normalizePositiveIntegerString(
  name: string,
  value: string | number,
): string {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${String(value)}`,
      `${name} must be a base-10 integer string in smallest units.`,
    );
  }
  if (BigInt(normalized) <= 0n) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${normalized}`,
      `${name} must be greater than 0.`,
    );
  }
  return normalized;
}

function normalizeOptionalCsv(
  value?: string | string[],
): string | undefined {
  if (value == null) return undefined;
  const parts = Array.isArray(value) ? value : value.split(",");
  const normalized = parts.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      "subcategory must include at least one non-empty value.",
    );
  }
  return normalized.join(",");
}

function normalizePaginationRange(start?: number, end?: number): void {
  if (start != null) assertIntegerInRange("start", start, 0);
  if (end != null) assertIntegerInRange("end", end, 0);
}

function normalizeOwnerPubkey(ownerPubkey: string): string {
  return validateSolanaAddress(ownerPubkey);
}

function normalizeOptionalPubkey(value?: string): string | undefined {
  return value != null ? validateSolanaAddress(value) : undefined;
}

function normalizeOptionalNonEmptyString(value?: string): string | undefined {
  return value != null ? assertNonEmptyString("value", value) : undefined;
}

export function resolveJupiterPredictionApiKey(): string {
  return resolveSharedJupiterApiKey();
}

export function requireJupiterPredictionApiKey(): string {
  return requireSharedJupiterApiKey({
    feature: "Jupiter Prediction API",
    errorCode: ErrorCodes.HTTP_REQUEST_FAILED,
  });
}

export function getJupiterPredictionHeaders(
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    "x-api-key": requireJupiterPredictionApiKey(),
    ...extraHeaders,
  };
}

export function validateJupiterPredictionEventsParams(
  params: JupiterPredictionEventsParams = {},
): JupiterPredictionEventsParams {
  normalizePaginationRange(params.start, params.end);

  return {
    provider: params.provider
      ? assertEnumValue("provider", params.provider, PREDICTION_PROVIDERS)
      : undefined,
    includeMarkets: params.includeMarkets,
    start: params.start,
    end: params.end,
    category: params.category
      ? assertEnumValue("category", params.category, PREDICTION_CATEGORIES)
      : undefined,
    subcategory: normalizeOptionalCsv(params.subcategory),
    sortBy: params.sortBy
      ? assertEnumValue("sortBy", params.sortBy, PREDICTION_SORT_BY)
      : undefined,
    sortDirection: params.sortDirection
      ? assertEnumValue("sortDirection", params.sortDirection, PREDICTION_SORT_DIRECTIONS)
      : undefined,
    filter: params.filter
      ? assertEnumValue("filter", params.filter, PREDICTION_FILTERS)
      : undefined,
  };
}

export function validateJupiterPredictionSearchEventsParams(
  params: JupiterPredictionSearchEventsParams,
): JupiterPredictionSearchEventsParams {
  const query = assertNonEmptyString("query", params.query);
  if (query.length > 200) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `Invalid query length: ${query.length}`,
      "query must be between 1 and 200 characters.",
    );
  }
  if (params.limit != null) assertIntegerInRange("limit", params.limit, 1, 20);

  return {
    provider: params.provider
      ? assertEnumValue("provider", params.provider, PREDICTION_PROVIDERS)
      : undefined,
    query,
    limit: params.limit,
  };
}

export function validateJupiterPredictionGetEventParams(
  params: JupiterPredictionGetEventParams,
): JupiterPredictionGetEventParams {
  return {
    eventId: assertNonEmptyString("eventId", params.eventId),
    includeMarkets: params.includeMarkets,
  };
}

export function validateJupiterPredictionSuggestedEventsParams(
  params: JupiterPredictionSuggestedEventsParams,
): JupiterPredictionSuggestedEventsParams {
  return {
    pubkey: validateSolanaAddress(params.pubkey),
    provider: params.provider
      ? assertEnumValue("provider", params.provider, PREDICTION_PROVIDERS)
      : undefined,
  };
}

export function validateJupiterPredictionEventMarketsParams(
  params: JupiterPredictionEventMarketsParams,
): JupiterPredictionEventMarketsParams {
  normalizePaginationRange(params.start, params.end);
  return {
    eventId: assertNonEmptyString("eventId", params.eventId),
    start: params.start,
    end: params.end,
  };
}

export function validateJupiterPredictionEventMarketParams(
  params: JupiterPredictionEventMarketParams,
): JupiterPredictionEventMarketParams {
  return {
    eventId: assertNonEmptyString("eventId", params.eventId),
    marketId: assertNonEmptyString("marketId", params.marketId),
  };
}

export function validateJupiterPredictionMarketParams(
  params: JupiterPredictionMarketParams,
): JupiterPredictionMarketParams {
  return {
    marketId: assertNonEmptyString("marketId", params.marketId),
  };
}

export function validateJupiterPredictionOrdersParams(
  params: JupiterPredictionOrdersParams = {},
): JupiterPredictionOrdersParams {
  normalizePaginationRange(params.start, params.end);
  return {
    start: params.start,
    end: params.end,
    ownerPubkey: normalizeOptionalPubkey(params.ownerPubkey),
  };
}

export function validateJupiterPredictionOrderParams(
  params: JupiterPredictionOrderParams,
): JupiterPredictionOrderParams {
  return {
    orderPubkey: validateSolanaAddress(params.orderPubkey),
  };
}

export function validateJupiterPredictionPositionsParams(
  params: JupiterPredictionPositionsParams = {},
): JupiterPredictionPositionsParams {
  normalizePaginationRange(params.start, params.end);
  return {
    start: params.start,
    end: params.end,
    ownerPubkey: normalizeOptionalPubkey(params.ownerPubkey),
    marketPubkey: normalizeOptionalPubkey(params.marketPubkey),
    marketId: normalizeOptionalNonEmptyString(params.marketId),
    isYes: params.isYes,
  };
}

export function validateJupiterPredictionPositionParams(
  params: JupiterPredictionPositionParams,
): JupiterPredictionPositionParams {
  return {
    positionPubkey: validateSolanaAddress(params.positionPubkey),
  };
}

export function validateJupiterPredictionHistoryParams(
  params: JupiterPredictionHistoryParams = {},
): JupiterPredictionHistoryParams {
  normalizePaginationRange(params.start, params.end);
  if (params.id != null) assertIntegerInRange("id", params.id, 1);
  return {
    start: params.start,
    end: params.end,
    ownerPubkey: normalizeOptionalPubkey(params.ownerPubkey),
    id: params.id,
    positionPubkey: normalizeOptionalPubkey(params.positionPubkey),
  };
}

export function validateJupiterPredictionProfileParams(
  params: JupiterPredictionProfileParams,
): JupiterPredictionProfileParams {
  return { ownerPubkey: validateSolanaAddress(params.ownerPubkey) };
}

export function validateJupiterPredictionPnlHistoryParams(
  params: JupiterPredictionPnlHistoryParams,
): JupiterPredictionPnlHistoryParams {
  if (params.count != null) assertIntegerInRange("count", params.count, 1, 1000);
  return {
    ownerPubkey: validateSolanaAddress(params.ownerPubkey),
    interval: params.interval
      ? assertEnumValue("interval", params.interval, PREDICTION_PNL_INTERVALS)
      : undefined,
    count: params.count,
  };
}

export function validateJupiterPredictionLeaderboardsParams(
  params: JupiterPredictionLeaderboardsParams = {},
): JupiterPredictionLeaderboardsParams {
  if (params.limit != null) assertIntegerInRange("limit", params.limit, 1, 100);
  return {
    period: params.period
      ? assertEnumValue("period", params.period, PREDICTION_LEADERBOARD_PERIODS)
      : undefined,
    limit: params.limit,
    metric: params.metric
      ? assertEnumValue("metric", params.metric, PREDICTION_LEADERBOARD_METRICS)
      : undefined,
  };
}

export function validateJupiterPredictionCreateOrderRequest(
  request: JupiterPredictionCreateOrderRequest,
): JupiterPredictionCreateOrderRequest {
  const ownerPubkey = normalizeOwnerPubkey(request.ownerPubkey);

  if (typeof request.isBuy !== "boolean") {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      "isBuy is required.",
    );
  }

  if (request.isBuy) {
    if (typeof request.isYes !== "boolean") {
      throw new EchoError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        "isYes is required for buy orders.",
      );
    }

    if (request.depositAmount == null) {
      throw new EchoError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        "depositAmount is required for buy orders.",
      );
    }

    if (!request.depositMint) {
      throw new EchoError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        "depositMint is required for buy orders.",
      );
    }

    return {
      ownerPubkey,
      marketId: assertNonEmptyString("marketId", request.marketId ?? ""),
      positionPubkey: request.positionPubkey
        ? validateSolanaAddress(request.positionPubkey)
        : undefined,
      isYes: request.isYes,
      isBuy: true,
      depositAmount: normalizePositiveIntegerString("depositAmount", request.depositAmount),
      depositMint: validateSolanaAddress(request.depositMint),
    };
  }

  if (request.positionPubkey == null) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      "positionPubkey is required for sell orders.",
    );
  }

  if (request.contracts == null) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      "contracts is required for sell orders.",
    );
  }

  if (request.depositAmount != null || request.depositMint != null) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      "depositAmount and depositMint are not supported for sell orders.",
    );
  }

  return {
    ownerPubkey,
    marketId: request.marketId ? assertNonEmptyString("marketId", request.marketId) : undefined,
    positionPubkey: validateSolanaAddress(request.positionPubkey),
    isYes: request.isYes,
    isBuy: false,
    contracts: normalizePositiveIntegerString("contracts", request.contracts),
  };
}

export function validateJupiterPredictionClosePositionRequest(
  request: JupiterPredictionClosePositionRequest,
): JupiterPredictionClosePositionRequest {
  return { ownerPubkey: normalizeOwnerPubkey(request.ownerPubkey) };
}

export function validateJupiterPredictionCloseAllPositionsRequest(
  request: JupiterPredictionCloseAllPositionsRequest,
): JupiterPredictionCloseAllPositionsRequest {
  return { ownerPubkey: normalizeOwnerPubkey(request.ownerPubkey) };
}

export function validateJupiterPredictionClaimPositionRequest(
  request: JupiterPredictionClaimPositionRequest,
): JupiterPredictionClaimPositionRequest {
  return { ownerPubkey: normalizeOwnerPubkey(request.ownerPubkey) };
}
