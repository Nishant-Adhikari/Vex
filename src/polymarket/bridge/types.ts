/**
 * Polymarket Bridge API types.
 * Base URL: https://bridge.polymarket.com
 */

export interface BridgeSupportedAsset {
  chainId: string;
  chainName: string;
  token: { name: string; symbol: string; address: string; decimals: number };
  minCheckoutUsd: number;
}

export interface BridgeDepositResponse {
  address: { evm?: string; svm?: string; btc?: string };
  note?: string;
}

export interface BridgeQuoteRequest {
  fromAmountBaseUnit: string;
  fromChainId: string;
  fromTokenAddress: string;
  recipientAddress: string;
  toChainId: string;
  toTokenAddress: string;
}

export interface BridgeQuoteResponse {
  estCheckoutTimeMs: number;
  estInputUsd: number;
  estOutputUsd: number;
  estToTokenBaseUnit: string;
  quoteId: string;
  estFeeBreakdown?: {
    gasUsd: number;
    totalImpactUsd: number;
    minReceived: number;
  };
}

export interface BridgeTransaction {
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountBaseUnit: string;
  toChainId: string;
  toTokenAddress: string;
  status: "DEPOSIT_DETECTED" | "PROCESSING" | "ORIGIN_TX_CONFIRMED" | "SUBMITTED" | "COMPLETED" | "FAILED";
  txHash?: string;
  createdTimeMs?: number;
}
