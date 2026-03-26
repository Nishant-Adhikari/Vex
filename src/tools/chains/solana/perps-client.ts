/**
 * Jupiter Perps API client — leveraged trading on Solana.
 * Markets: SOL, BTC, ETH. Collateral: SOL, BTC, ETH, USDC.
 * Host: perps-api.jup.ag/v2 (separate from Ultra swap API).
 * Wire format matches official Jupiter CLI PerpsClient.
 */

import { fetchJson } from "../../../utils/http.js";
import { getJupiterHeaders } from "./jupiter-client.js";

const PERPS_BASE = "https://perps-api.jup.ag/v2";

function perpsHeaders(): Record<string, string> {
  return { ...getJupiterHeaders(), "Content-Type": "application/json" };
}

// --- Perps asset mints (same as Jupiter CLI Asset.ts) ---

export const PERPS_ASSETS: Record<string, { mint: string; decimals: number }> = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  BTC: { mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", decimals: 8 },
  ETH: { mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", decimals: 8 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};

export function resolvePerpsAsset(name: string): { mint: string; decimals: number } {
  const asset = PERPS_ASSETS[name.toUpperCase()];
  if (!asset) throw new Error(`Unknown perps asset: ${name}. Available: ${Object.keys(PERPS_ASSETS).join(", ")}`);
  return asset;
}

// --- Types (matching Jupiter CLI PerpsClient wire format) ---

export interface MarketStats {
  price: string;
  priceChange24H: string;
  priceHigh24H: string;
  priceLow24H: string;
  volume: string;
}

export interface TpslRequest {
  positionRequestPubkey: string;
  requestType: "tp" | "sl";
  triggerPriceUsd: string | null;
  sizeUsd: string;
  sizePercentage: string;
  entirePosition: boolean;
}

export interface Position {
  asset: string;
  assetMint: string;
  collateralToken: string;
  collateralMint: string;
  positionPubkey: string;
  side: string;
  leverage: string;
  sizeUsd: string;
  collateralUsd: string;
  valueUsd: string;
  entryPriceUsd: string;
  markPriceUsd: string;
  liquidationPriceUsd: string;
  pnlAfterFeesUsd: string;
  pnlAfterFeesPct: string;
  totalFeesUsd: string;
  createdTime: number;
  tpslRequests: TpslRequest[];
}

export interface LimitOrder {
  positionRequestPubkey: string;
  positionPubkey: string;
  side: string;
  triggerPrice: string | null;
  sizeUsdDelta: string;
  collateralUsd: string;
  liquidationPriceUsd: string;
}

export interface Trade {
  action: "Increase" | "Decrease";
  side: "long" | "short";
  mint: string;
  positionPubkey: string;
  price: string;
  size: string;
  pnl: string | null;
  pnlPercentage: string | null;
  fee: string;
  txHash: string;
  createdTime: number;
}

export interface TxMetadata {
  blockhash: string;
  lastValidBlockHeight: string;
}

export interface IncreasePositionResponse {
  positionPubkey: string;
  quote: {
    sizeUsdDelta: string;
    leverage: string;
    entryPriceUsd?: string;
    averagePriceUsd: string;
    liquidationPriceUsd: string;
    openFeeUsd: string;
  };
  serializedTxBase64: string;
  txMetadata: TxMetadata;
}

export interface DecreasePositionResponse {
  positionPubkey: string;
  quote: {
    sizeUsdDelta: string;
    pnlAfterFeesUsd: string;
    pnlAfterFeesPercent: string;
    totalFeeUsd: string;
    transferAmountUsd: string;
    transferTokenMint: string;
  };
  serializedTxBase64: string;
  txMetadata: TxMetadata;
}

export interface CloseAllResponse {
  serializedTxs: Array<{
    serializedTxBase64: string;
    positionRequestPubkey: string;
  }>;
  txMetadata: TxMetadata;
}

export interface LimitOrderResponse {
  positionPubkey: string | null;
  positionRequestPubkey?: string | null;
  quote: {
    sizeUsdDelta: string;
    leverage: string;
    liquidationPriceUsd: string;
  };
  serializedTxBase64: string | null;
  txMetadata: TxMetadata | null;
}

export interface TpslResponse {
  serializedTxBase64: string;
  tpslRequests: Array<{
    requestType: string;
    positionRequestPubkey: string;
    estimatedPnlUsd: string;
    estimatedPnlPercent: string;
    hasProfit: boolean;
  }>;
  txMetadata: TxMetadata;
}

export interface CancelResponse {
  serializedTxBase64: string;
  txMetadata: TxMetadata;
}

export interface ExecuteResponse {
  action: string;
  txid: string;
}

// --- API methods ---

export async function perpsGetMarkets(): Promise<Array<{ asset: string } & MarketStats>> {
  const headers = getJupiterHeaders();
  return Promise.all(
    ["SOL", "BTC", "ETH"].map(async (asset) => {
      const mint = PERPS_ASSETS[asset]!.mint;
      const stats = await fetchJson<MarketStats>(
        `${PERPS_BASE}/market-stats?mint=${mint}`,
        { headers },
      );
      return { asset, ...stats };
    }),
  );
}

export async function perpsGetPositions(walletAddress: string): Promise<{
  positions: Position[];
  limitOrders: LimitOrder[];
}> {
  const headers = getJupiterHeaders();
  const [posResult, ordersResult] = await Promise.all([
    fetchJson<{ count: number; dataList: Position[] }>(
      `${PERPS_BASE}/positions?walletAddress=${walletAddress}`,
      { headers },
    ),
    fetchJson<{ count: number; dataList: LimitOrder[] }>(
      `${PERPS_BASE}/orders/limit?walletAddress=${walletAddress}`,
      { headers },
    ),
  ]);
  return {
    positions: posResult.dataList ?? [],
    limitOrders: ordersResult.dataList ?? [],
  };
}

export async function perpsGetTrades(params: {
  walletAddress: string;
  asset?: string;
  side?: string;
  action?: string;
  limit?: number;
}): Promise<{ count: number; trades: Trade[] }> {
  const headers = getJupiterHeaders();
  const qs = new URLSearchParams({ walletAddress: params.walletAddress });
  if (params.asset) qs.set("mint", resolvePerpsAsset(params.asset).mint);
  if (params.side) qs.set("side", params.side);
  if (params.action) qs.set("action", params.action);
  if (params.limit) qs.set("end", String(params.limit));

  const result = await fetchJson<{ count: number; dataList: Trade[] }>(
    `${PERPS_BASE}/trades?${qs.toString()}`,
    { headers },
  );
  return { count: result.count, trades: result.dataList ?? [] };
}

export async function perpsIncreasePosition(req: {
  asset: string;
  inputToken: string;
  inputTokenAmount?: string;
  side: string;
  maxSlippageBps: string;
  leverage?: string;
  sizeUsdDelta?: string;
  walletAddress: string;
  tpsl?: Array<{ receiveToken: string; triggerPrice: string; requestType: string }>;
}): Promise<IncreasePositionResponse> {
  return fetchJson<IncreasePositionResponse>(
    `${PERPS_BASE}/positions/increase`,
    { method: "POST", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}

export async function perpsDecreasePosition(req: {
  positionPubkey: string;
  receiveToken: string;
  sizeUsdDelta?: string;
  entirePosition?: boolean;
  maxSlippageBps: string;
}): Promise<DecreasePositionResponse> {
  return fetchJson<DecreasePositionResponse>(
    `${PERPS_BASE}/positions/decrease`,
    { method: "POST", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}

export async function perpsCloseAll(walletAddress: string): Promise<CloseAllResponse> {
  return fetchJson<CloseAllResponse>(
    `${PERPS_BASE}/positions/close-all`,
    { method: "POST", headers: perpsHeaders(), body: JSON.stringify({ walletAddress }) },
  );
}

export async function perpsCreateLimitOrder(req: {
  asset: string;
  inputToken: string;
  inputTokenAmount?: string;
  side: string;
  triggerPrice: string;
  leverage?: string;
  sizeUsdDelta?: string;
  walletAddress: string;
}): Promise<LimitOrderResponse> {
  return fetchJson<LimitOrderResponse>(
    `${PERPS_BASE}/orders/limit`,
    { method: "POST", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}

export async function perpsUpdateLimitOrder(req: {
  positionRequestPubkey: string;
  triggerPrice: string;
}): Promise<LimitOrderResponse> {
  return fetchJson<LimitOrderResponse>(
    `${PERPS_BASE}/orders/limit`,
    { method: "PATCH", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}

export async function perpsCancelLimitOrder(positionRequestPubkey: string): Promise<CancelResponse> {
  return fetchJson<CancelResponse>(
    `${PERPS_BASE}/orders/limit`,
    { method: "DELETE", headers: perpsHeaders(), body: JSON.stringify({ positionRequestPubkey }) },
  );
}

export async function perpsSetTpsl(req: {
  walletAddress: string;
  positionPubkey: string;
  tpsl: Array<{
    receiveToken: string;
    triggerPrice: string;
    requestType: string;
    entirePosition: boolean;
    sizeUsdDelta?: string;
  }>;
}): Promise<TpslResponse> {
  return fetchJson<TpslResponse>(
    `${PERPS_BASE}/tpsl`,
    { method: "POST", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}

export async function perpsUpdateTpsl(req: {
  positionRequestPubkey: string;
  triggerPrice: string;
}): Promise<TpslResponse> {
  return fetchJson<TpslResponse>(
    `${PERPS_BASE}/tpsl`,
    { method: "PATCH", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}

export async function perpsCancelTpsl(positionRequestPubkey: string): Promise<CancelResponse> {
  return fetchJson<CancelResponse>(
    `${PERPS_BASE}/tpsl`,
    { method: "DELETE", headers: perpsHeaders(), body: JSON.stringify({ positionRequestPubkey }) },
  );
}

export async function perpsExecute(req: {
  action: string;
  serializedTxBase64: string;
}): Promise<ExecuteResponse> {
  return fetchJson<ExecuteResponse>(
    `${PERPS_BASE}/transaction/execute`,
    { method: "POST", headers: perpsHeaders(), body: JSON.stringify(req) },
  );
}
