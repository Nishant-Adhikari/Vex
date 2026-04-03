/**
 * KyberSwap ZaaS (Zap as a Service) types.
 *
 * Base URL: https://zap-api.kyberswap.com/{chain}/api/v1/...
 * Supports: Zap In, Zap Out, Zap Migrate
 */

import type { Address } from "viem";

// ── Zap In ──────────────────────────────────────────────────────────

export interface ZapInRouteParams {
  dex: string;
  "pool.id": string;
  "position.id"?: string;
  "position.tickLower"?: number;
  "position.tickUpper"?: number;
  tokensIn: string;
  amountsIn: string;
  slippage?: number;
  "aggregatorOptions.disable"?: boolean;
  "aggregatorOptions.includedSources"?: string;
  "aggregatorOptions.excludedSources"?: string;
  feeAddress?: string;
  feePcm?: number;
}

export interface ZapRouteResponse {
  code: number;
  message?: string;
  data: {
    routeSummary?: unknown;
    zapDetails?: ZapDetails;
    route?: string;
    routerAddress?: Address;
  };
  requestId?: string;
}

export interface ZapDetails {
  actions: ZapAction[];
  priceImpact?: number;
  initialAmountUsd?: string;
  finalAmountUsd?: string;
}

export interface ZapAction {
  type: string;
  protocolFee?: ZapFeeAction;
  partnerFee?: ZapFeeAction;
  aggregatorSwap?: ZapSwapAction;
  poolSwap?: ZapSwapAction;
  addLiquidity?: ZapLiquidityAction;
  removeLiquidity?: ZapLiquidityAction;
  refund?: ZapRefundAction;
}

export interface ZapFeeAction {
  amount: string;
  token: string;
}

export interface ZapSwapAction {
  swaps: Array<{ tokenIn: ZapTokenAmount; tokenOut: ZapTokenAmount }>;
}

export interface ZapLiquidityAction {
  tokens?: ZapTokenAmount[];
  token0?: ZapTokenAmount;
  token1?: ZapTokenAmount;
}

export interface ZapRefundAction {
  tokens: ZapTokenAmount[];
}

export interface ZapTokenAmount {
  address: string;
  amount: string;
  amountUsd?: string;
}

// ── Zap Build ───────────────────────────────────────────────────────

export interface ZapBuildRequest {
  sender: Address;
  recipient: Address;
  route: string;
  deadline?: number;
  source?: string;
}

export interface ZapBuildResponse {
  code: number;
  message?: string;
  data: {
    callData: string;
    routerAddress: Address;
    value: string;
  };
  requestId?: string;
}

// ── Zap Out ─────────────────────────────────────────────────────────

export interface ZapOutRouteParams {
  dexFrom: string;
  "poolFrom.id": string;
  "positionFrom.id": string;
  liquidityOut?: string;
  collectFee?: boolean;
  tokenOut: string;
  slippage?: number;
  "aggregatorOptions.disable"?: boolean;
  "aggregatorOptions.includedSources"?: string;
  "aggregatorOptions.excludedSources"?: string;
  feeAddress?: string;
  feePcm?: number;
}

// ── Zap Migrate ─────────────────────────────────────────────────────

export interface ZapMigrateRouteParams {
  dexFrom: string;
  dexTo: string;
  "poolFrom.id": string;
  "poolTo.id": string;
  "positionFrom.id": string;
  "positionTo.id"?: string;
  "positionTo.tickLower"?: number;
  "positionTo.tickUpper"?: number;
  liquidityOut?: string;
  collectFee?: boolean;
  slippage?: number;
  "aggregatorOptions.disable"?: boolean;
  "aggregatorOptions.includedSources"?: string;
  "aggregatorOptions.excludedSources"?: string;
  feeAddress?: string;
  feePcm?: number;
}
