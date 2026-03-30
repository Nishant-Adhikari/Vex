/**
 * Jupiter Price API V3 wire-first contracts.
 * Verified from official Jupiter docs and API reference on 2026-03-30.
 */

import type { TokenMetadata } from "../../shared/types.js";

export const JUPITER_PRICE_V3_BASE_URL = "https://api.jup.ag";

export interface JupiterPriceEntry {
  createdAt: string;
  liquidity: number;
  usdPrice: number;
  blockId: number | null;
  decimals: number;
  priceChange24h: number | null;
  [key: string]: unknown;
}

export type JupiterPriceResponse = Record<string, JupiterPriceEntry>;

export interface JupiterPriceRequestParams {
  ids: string[];
}

export interface JupiterSinglePriceResult {
  mint: string;
  price?: JupiterPriceEntry;
  found: boolean;
  raw: JupiterPriceResponse;
}

export interface JupiterResolvedPriceResult {
  query: string;
  mint: string;
  token: TokenMetadata;
  price?: JupiterPriceEntry;
  found: boolean;
}

export interface JupiterResolvedPriceBatch {
  resolved: JupiterResolvedPriceResult[];
  raw: JupiterPriceResponse;
}

