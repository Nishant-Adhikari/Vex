/**
 * Runtime validators for Polymarket Bridge API responses.
 */

import { isRecord } from "../../utils/validation-helpers.js";
import type { BridgeSupportedAsset, BridgeDepositResponse, BridgeQuoteResponse, BridgeTransaction } from "./types.js";

export function validateSupportedAssetsResponse(raw: unknown): BridgeSupportedAsset[] {
  if (!isRecord(raw) || !Array.isArray(raw.supportedAssets)) return [];
  return raw.supportedAssets.map((a: unknown) => {
    if (!isRecord(a)) return { chainId: "", chainName: "", token: { name: "", symbol: "", address: "", decimals: 0 }, minCheckoutUsd: 0 };
    const token = isRecord(a.token) ? a.token : {};
    return {
      chainId: typeof a.chainId === "string" ? a.chainId : "",
      chainName: typeof a.chainName === "string" ? a.chainName : "",
      token: {
        name: typeof token.name === "string" ? token.name : "",
        symbol: typeof token.symbol === "string" ? token.symbol : "",
        address: typeof token.address === "string" ? token.address : "",
        decimals: typeof token.decimals === "number" ? token.decimals : 0,
      },
      minCheckoutUsd: typeof a.minCheckoutUsd === "number" ? a.minCheckoutUsd : 0,
    };
  });
}

export function validateDepositResponse(raw: unknown): BridgeDepositResponse {
  if (!isRecord(raw)) return { address: {} };
  const addr = isRecord(raw.address) ? raw.address : {};
  return {
    address: {
      evm: typeof addr.evm === "string" ? addr.evm : undefined,
      svm: typeof addr.svm === "string" ? addr.svm : undefined,
      btc: typeof addr.btc === "string" ? addr.btc : undefined,
    },
    note: typeof raw.note === "string" ? raw.note : undefined,
  };
}

export function validateQuoteResponse(raw: unknown): BridgeQuoteResponse {
  if (!isRecord(raw)) throw new Error("Expected quote response");
  return {
    estCheckoutTimeMs: typeof raw.estCheckoutTimeMs === "number" ? raw.estCheckoutTimeMs : 0,
    estInputUsd: typeof raw.estInputUsd === "number" ? raw.estInputUsd : 0,
    estOutputUsd: typeof raw.estOutputUsd === "number" ? raw.estOutputUsd : 0,
    estToTokenBaseUnit: typeof raw.estToTokenBaseUnit === "string" ? raw.estToTokenBaseUnit : "0",
    quoteId: typeof raw.quoteId === "string" ? raw.quoteId : "",
    estFeeBreakdown: isRecord(raw.estFeeBreakdown) ? {
      gasUsd: typeof raw.estFeeBreakdown.gasUsd === "number" ? raw.estFeeBreakdown.gasUsd : 0,
      totalImpactUsd: typeof raw.estFeeBreakdown.totalImpactUsd === "number" ? raw.estFeeBreakdown.totalImpactUsd : 0,
      minReceived: typeof raw.estFeeBreakdown.minReceived === "number" ? raw.estFeeBreakdown.minReceived : 0,
    } : undefined,
  };
}

export function validateTransactionsResponse(raw: unknown): BridgeTransaction[] {
  if (!isRecord(raw) || !Array.isArray(raw.transactions)) return [];
  return raw.transactions.map((t: unknown) => {
    if (!isRecord(t)) return { fromChainId: "", fromTokenAddress: "", fromAmountBaseUnit: "", toChainId: "", toTokenAddress: "", status: "FAILED" as const };
    return {
      fromChainId: typeof t.fromChainId === "string" ? t.fromChainId : "",
      fromTokenAddress: typeof t.fromTokenAddress === "string" ? t.fromTokenAddress : "",
      fromAmountBaseUnit: typeof t.fromAmountBaseUnit === "string" ? t.fromAmountBaseUnit : "",
      toChainId: typeof t.toChainId === "string" ? t.toChainId : "",
      toTokenAddress: typeof t.toTokenAddress === "string" ? t.toTokenAddress : "",
      status: typeof t.status === "string" ? t.status as BridgeTransaction["status"] : "FAILED",
      txHash: typeof t.txHash === "string" ? t.txHash : undefined,
      createdTimeMs: typeof t.createdTimeMs === "number" ? t.createdTimeMs : undefined,
    };
  });
}
