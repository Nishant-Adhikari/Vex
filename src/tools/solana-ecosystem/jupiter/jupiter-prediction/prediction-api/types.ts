/**
 * Jupiter Prediction API wire-first contracts.
 * Verified from official Jupiter docs and indexed OpenAPI snippets on 2026-03-30.
 */

import type { TransferResult } from "../../../shared/types.js";
import {
  JUPITER_PREDICTION_API_BASE_URL,
  JUPITER_PREDICTION_DEFAULT_PROVIDER,
  JUPITER_PREDICTION_JUPUSD_MINT,
  JUPITER_PREDICTION_USDC_MINT,
} from "../constants.js";

export {
  JUPITER_PREDICTION_API_BASE_URL,
  JUPITER_PREDICTION_DEFAULT_PROVIDER,
  JUPITER_PREDICTION_JUPUSD_MINT,
  JUPITER_PREDICTION_USDC_MINT,
};

export type JupiterPredictionProvider = "kalshi" | "polymarket";
export type JupiterPredictionCategory =
  | "all"
  | "crypto"
  | "sports"
  | "politics"
  | "esports"
  | "culture"
  | "economics"
  | "tech";
export type JupiterPredictionFilter = "new" | "live" | "trending";
export type JupiterPredictionSortBy = "volume" | "beginAt";
export type JupiterPredictionSortDirection = "asc" | "desc";
export type JupiterPredictionMarketStatus = "open" | "closed" | "cancelled" | (string & {});
export type JupiterPredictionLeaderboardPeriod = "all_time" | "weekly" | "monthly";
export type JupiterPredictionLeaderboardMetric = "pnl" | "volume" | "win_rate";
export type JupiterPredictionPnlInterval = "24h" | "1w" | "1m";

export interface JupiterPredictionEventsParams {
  provider?: JupiterPredictionProvider;
  includeMarkets?: boolean;
  start?: number;
  end?: number;
  category?: JupiterPredictionCategory;
  subcategory?: string | string[];
  sortBy?: JupiterPredictionSortBy;
  sortDirection?: JupiterPredictionSortDirection;
  filter?: JupiterPredictionFilter;
}

export interface JupiterPredictionSearchEventsParams {
  provider?: JupiterPredictionProvider;
  query: string;
  limit?: number;
}

export interface JupiterPredictionGetEventParams {
  eventId: string;
  includeMarkets?: boolean;
}

export interface JupiterPredictionSuggestedEventsParams {
  pubkey: string;
  provider?: JupiterPredictionProvider;
}

export interface JupiterPredictionEventMarketsParams {
  eventId: string;
  start?: number;
  end?: number;
}

export interface JupiterPredictionEventMarketParams {
  eventId: string;
  marketId: string;
}

export interface JupiterPredictionMarketParams {
  marketId: string;
}

export interface JupiterPredictionOrdersParams {
  start?: number;
  end?: number;
  ownerPubkey?: string;
}

export interface JupiterPredictionOrderParams {
  orderPubkey: string;
}

export interface JupiterPredictionPositionsParams {
  start?: number;
  end?: number;
  ownerPubkey?: string;
  marketPubkey?: string;
  marketId?: string;
  isYes?: boolean;
}

export interface JupiterPredictionPositionParams {
  positionPubkey: string;
}

export interface JupiterPredictionHistoryParams {
  start?: number;
  end?: number;
  ownerPubkey?: string;
  id?: number;
  positionPubkey?: string;
}

export interface JupiterPredictionProfileParams {
  ownerPubkey: string;
}

export interface JupiterPredictionPnlHistoryParams {
  ownerPubkey: string;
  interval?: JupiterPredictionPnlInterval;
  count?: number;
}

export interface JupiterPredictionLeaderboardsParams {
  period?: JupiterPredictionLeaderboardPeriod;
  limit?: number;
  metric?: JupiterPredictionLeaderboardMetric;
}

export interface JupiterPredictionCreateOrderRequest {
  ownerPubkey: string;
  marketId?: string;
  positionPubkey?: string;
  isYes?: boolean;
  isBuy: boolean;
  contracts?: string | number;
  depositAmount?: string | number;
  depositMint?: string;
}

export interface JupiterPredictionClosePositionRequest {
  ownerPubkey: string;
}

export interface JupiterPredictionCloseAllPositionsRequest {
  ownerPubkey: string;
}

export interface JupiterPredictionClaimPositionRequest {
  ownerPubkey: string;
}

export interface JupiterPredictionPagination {
  start: number;
  end: number;
  total: number;
  hasNext: boolean;
}

export interface JupiterPredictionEventMetadata {
  eventId: string;
  title?: string;
  subtitle?: string;
  slug?: string;
  series?: string;
  closeTime?: string;
  imageUrl?: string;
  isLive?: boolean;
}

export interface JupiterPredictionMarketMetadata {
  marketId: string;
  eventId?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  status?: string;
  result?: string;
  closeTime?: number;
  openTime?: number;
  isTeamMarket?: boolean;
  rulesPrimary?: string;
  rulesSecondary?: string;
}

export interface JupiterPredictionMarketPricing {
  buyYesPriceUsd?: number | null;
  buyNoPriceUsd?: number | null;
  sellYesPriceUsd?: number | null;
  sellNoPriceUsd?: number | null;
  volume?: number;
}

export interface JupiterPredictionMarket {
  marketId: string;
  status: JupiterPredictionMarketStatus;
  result: string | null;
  openTime: number;
  closeTime: number;
  resolveAt: number | null;
  marketResultPubkey?: string | null;
  imageUrl?: string | null;
  metadata?: JupiterPredictionMarketMetadata;
  pricing?: JupiterPredictionMarketPricing;
}

export interface JupiterPredictionEvent {
  eventId: string;
  isActive: boolean;
  isLive: boolean;
  category: string;
  subcategory: string;
  tags?: string[];
  metadata?: JupiterPredictionEventMetadata;
  markets?: JupiterPredictionMarket[];
  volumeUsd: string;
  closeCondition: string;
  beginAt: string | null;
  rulesPdf: string;
}

export interface JupiterPredictionEventsResponse {
  data: JupiterPredictionEvent[];
  pagination: JupiterPredictionPagination;
}

export interface JupiterPredictionSearchEventsResponse {
  data: JupiterPredictionEvent[];
}

export interface JupiterPredictionSuggestedEventsResponse {
  data: JupiterPredictionEvent[];
}

export interface JupiterPredictionEventMarketsResponse {
  data: JupiterPredictionMarket[];
  pagination: JupiterPredictionPagination;
}

export type JupiterPredictionEventMarketResponse = JupiterPredictionMarket;
export type JupiterPredictionMarketResponse = JupiterPredictionMarket;

export type JupiterPredictionOrderbookLevel = [priceCents: number, quantity: number];
export type JupiterPredictionOrderbookDollarLevel = [priceUsd: string, quantity: number];

export interface JupiterPredictionOrderbook {
  yes: JupiterPredictionOrderbookLevel[];
  no: JupiterPredictionOrderbookLevel[];
  yes_dollars: JupiterPredictionOrderbookDollarLevel[];
  no_dollars: JupiterPredictionOrderbookDollarLevel[];
}

export type JupiterPredictionOrderbookResponse = JupiterPredictionOrderbook | null;

export interface JupiterPredictionTradingStatusResponse {
  trading_active: boolean;
}

export interface JupiterPredictionOrder {
  pubkey: string;
  owner: string;
  ownerPubkey: string;
  market: string;
  marketId: string;
  marketIdHash: string;
  eventId: string;
  position: string;
  status: "pending" | "filled" | "failed" | (string & {});
  isYes: boolean;
  isBuy: boolean;
  createdAt: number;
  updatedAt: number;
  contracts: string;
  maxFillPriceUsd: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  filledAt: number;
  filledContracts: string;
  avgFillPriceUsd: string;
  settled: boolean;
  orderId: string;
  sizeUsd: string;
  eventMetadata: JupiterPredictionEventMetadata;
  marketMetadata: JupiterPredictionMarketMetadata;
  externalOrderId: string;
  bump: number;
}

export interface JupiterPredictionOrdersResponse {
  data: JupiterPredictionOrder[];
  pagination: JupiterPredictionPagination;
}

export type JupiterPredictionOrderResponse = JupiterPredictionOrder;

export interface JupiterPredictionOrderStatusHistoryItem {
  eventType: string;
  status: string;
  rawStatus: string;
  timestamp: number;
  signature: string;
  externalOrderId: string;
  orderId: string;
}

export interface JupiterPredictionOrderStatusResponse {
  orderPubkey: string;
  status: string;
  latestEventType: string;
  latestSignature: string;
  externalOrderId: string;
  orderId: string;
  history: JupiterPredictionOrderStatusHistoryItem[];
}

export interface JupiterPredictionPosition {
  pubkey: string;
  owner: string;
  ownerPubkey: string;
  market: string;
  marketId: string;
  marketIdHash: string;
  isYes: boolean;
  contracts: string;
  totalCostUsd: string;
  sizeUsd: string;
  valueUsd: string | null;
  avgPriceUsd: string;
  markPriceUsd: string | null;
  sellPriceUsd: string | null;
  pnlUsd: string | null;
  pnlUsdPercent: number | null;
  pnlUsdAfterFees: string | null;
  pnlUsdAfterFeesPercent: number | null;
  openOrders: number;
  feesPaidUsd: string;
  realizedPnlUsd: number;
  claimed: boolean;
  claimedUsd: string;
  openedAt: number;
  updatedAt: number;
  claimableAt: number | null;
  payoutUsd: string;
  bump: number;
  eventId: string;
  eventMetadata: JupiterPredictionEventMetadata;
  marketMetadata: JupiterPredictionMarketMetadata;
  settlementDate: number | null;
  claimable: boolean;
}

export interface JupiterPredictionPositionsResponse {
  data: JupiterPredictionPosition[];
  pagination: JupiterPredictionPagination;
}

export type JupiterPredictionPositionResponse = JupiterPredictionPosition;

export interface JupiterPredictionHistoryEvent {
  id: number;
  eventType: string;
  signature: string;
  slot: string;
  timestamp: number;
  orderPubkey: string;
  positionPubkey: string;
  marketId: string;
  ownerPubkey: string;
  keeperPubkey: string;
  externalOrderId: string;
  orderId: string;
  isBuy: boolean;
  isYes: boolean;
  contracts: string;
  filledContracts: string;
  contractsSettled: string;
  maxFillPriceUsd: string;
  avgFillPriceUsd: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  depositAmountUsd: string;
  totalCostUsd: string;
  feeUsd: string | null;
  grossProceedsUsd: string;
  netProceedsUsd: string;
  transferAmountToken: string | null;
  realizedPnl: string | null;
  realizedPnlBeforeFees: string | null;
  payoutAmountUsd: string;
  eventId: string;
  marketMetadata: JupiterPredictionMarketMetadata;
  eventMetadata: JupiterPredictionEventMetadata;
}

export interface JupiterPredictionHistoryResponse {
  data: JupiterPredictionHistoryEvent[];
  pagination: JupiterPredictionPagination;
}

export interface JupiterPredictionProfileResponse {
  ownerPubkey: string;
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  predictionsCount: string;
  correctPredictions: string;
  wrongPredictions: string;
  totalActiveContracts: string;
  totalPositionsValueUsd: string;
}

export interface JupiterPredictionPnlHistoryPoint {
  timestamp: number;
  realizedPnlUsd: string;
}

export interface JupiterPredictionPnlHistoryResponse {
  ownerPubkey: string;
  history: JupiterPredictionPnlHistoryPoint[];
}

export interface JupiterPredictionTrade {
  id: number;
  ownerPubkey: string;
  marketId: string;
  message: string;
  timestamp: number;
  action: "buy" | "sell" | (string & {});
  side: "yes" | "no" | (string & {});
  eventTitle: string;
  marketTitle: string;
  amountUsd: string;
  priceUsd: string;
  eventImageUrl: string;
  eventId: string;
}

export interface JupiterPredictionTradesResponse {
  data: JupiterPredictionTrade[];
}

export interface JupiterPredictionLeaderboardEntry {
  ownerPubkey: string;
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  predictionsCount: number;
  correctPredictions: number;
  wrongPredictions: number;
  winRatePct: string;
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface JupiterPredictionLeaderboardSummaryPeriod {
  totalVolumeUsd: string;
  predictionsCount: number;
}

export interface JupiterPredictionLeaderboardsResponse {
  data: JupiterPredictionLeaderboardEntry[];
  summary: {
    all_time: JupiterPredictionLeaderboardSummaryPeriod;
    weekly: JupiterPredictionLeaderboardSummaryPeriod;
    monthly: JupiterPredictionLeaderboardSummaryPeriod;
  };
}

export interface JupiterPredictionVaultInfoResponse {
  pubkey: string;
  data: Record<string, string>;
  vaultBalance: string;
}

export interface JupiterPredictionTransactionMeta {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface JupiterPredictionTxMetaFields {
  txMeta?: JupiterPredictionTransactionMeta | null;
  blockhash?: string;
  lastValidBlockHeight?: number;
}

export interface JupiterPredictionCreateOrderDetails {
  orderPubkey: string | null;
  orderAtaPubkey: string | null;
  userPubkey: string;
  marketId: string;
  marketIdHash: string;
  positionPubkey: string;
  isBuy: boolean;
  isYes: boolean;
  contracts: string;
  newContracts: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  externalOrderId: string | null;
  orderCostUsd: string;
  newAvgPriceUsd: string;
  newSizeUsd: string;
  newPayoutUsd: string;
  estimatedProtocolFeeUsd: string;
  estimatedVenueFeeUsd: string;
  estimatedTotalFeeUsd: string;
}

export interface JupiterPredictionCreateOrderResponse extends JupiterPredictionTxMetaFields {
  transaction: string | null;
  externalOrderId: string | null;
  order: JupiterPredictionCreateOrderDetails;
}

export interface JupiterPredictionClaimPositionDetails {
  positionPubkey: string;
  marketPubkey: string;
  userPubkey: string;
  ownerPubkey: string;
  isYes: boolean;
  contracts: string;
  payoutAmountUsd: string;
}

export interface JupiterPredictionClaimPositionResponse extends JupiterPredictionTxMetaFields {
  transaction: string;
  position: JupiterPredictionClaimPositionDetails;
}

export type JupiterPredictionCloseAllPositionsItem =
  | JupiterPredictionCreateOrderResponse
  | JupiterPredictionClaimPositionResponse;

export interface JupiterPredictionCloseAllPositionsResponse {
  data: JupiterPredictionCloseAllPositionsItem[];
}

export interface JupiterPredictionExecutionResult<T> extends TransferResult {
  signer: string;
  raw: T;
}

export interface JupiterPredictionCloseAllExecutionItem
  extends JupiterPredictionExecutionResult<JupiterPredictionCloseAllPositionsItem> {
  kind: "order" | "claim";
}

export interface JupiterPredictionCloseAllExecutionResult {
  signer: string;
  results: JupiterPredictionCloseAllExecutionItem[];
  raw: JupiterPredictionCloseAllPositionsResponse;
}
