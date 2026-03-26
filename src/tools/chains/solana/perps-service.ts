/**
 * Jupiter Perps service — leveraged trading on Solana.
 * Markets: SOL, BTC, ETH. Min collateral $10.
 * Sign flow: API returns serializedTxBase64 → deserialize → sign → POST /transaction/execute.
 */

import { Keypair } from "@solana/web3.js";
import {
  perpsGetMarkets,
  perpsGetPositions,
  perpsGetTrades,
  perpsIncreasePosition,
  perpsDecreasePosition,
  perpsCloseAll,
  perpsCreateLimitOrder,
  perpsUpdateLimitOrder,
  perpsCancelLimitOrder,
  perpsSetTpsl,
  perpsUpdateTpsl,
  perpsCancelTpsl,
  perpsExecute,
  resolvePerpsAsset,
  PERPS_ASSETS,
  type MarketStats,
  type Position,
  type LimitOrder,
  type Trade,
} from "./perps-client.js";
import { deserializeVersionedTx, signVersionedTx } from "./tx.js";
import { EchoError, ErrorCodes } from "../../../errors.js";

// --- Helpers ---

async function signAndExecute(
  secretKey: Uint8Array,
  serializedTxBase64: string,
  action: string,
): Promise<string> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const tx = deserializeVersionedTx(serializedTxBase64);
  signVersionedTx(tx, [keypair]);
  const signedBase64 = Buffer.from(tx.serialize()).toString("base64");

  const result = await perpsExecute({ action, serializedTxBase64: signedBase64 });
  return result.txid;
}

// --- Read operations ---

export { perpsGetMarkets as getPerpsMarkets };

export async function getPerpsPositions(walletAddress: string): Promise<{
  positions: Position[];
  limitOrders: LimitOrder[];
}> {
  return perpsGetPositions(walletAddress);
}

export async function getPerpsHistory(params: {
  walletAddress: string;
  asset?: string;
  side?: string;
  limit?: number;
}): Promise<{ count: number; trades: Trade[] }> {
  return perpsGetTrades(params);
}

// --- Open / Close positions ---

export async function openPerpsPosition(
  secretKey: Uint8Array,
  params: {
    asset: string;
    side: string;
    amountUsd: number;
    inputToken?: string;
    leverage?: number;
    sizeUsd?: number;
    slippageBps?: number;
    tp?: number;
    sl?: number;
    limitPrice?: number;
  },
): Promise<{ positionPubkey: string; signature: string; type: "market-order" | "limit-order"; quote: Record<string, string> }> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const walletAddress = keypair.publicKey.toBase58();
  const asset = resolvePerpsAsset(params.asset);
  const inputAsset = resolvePerpsAsset(params.inputToken ?? "SOL");
  const side = normalizeSide(params.side);
  const slippage = String(params.slippageBps ?? 200);

  // Limit order path
  if (params.limitPrice != null) {
    if (params.tp != null || params.sl != null) {
      throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "Cannot combine --limit with --tp/--sl");
    }

    const resp = await perpsCreateLimitOrder({
      asset: asset.mint,
      inputToken: inputAsset.mint,
      inputTokenAmount: String(Math.round(params.amountUsd * 10 ** inputAsset.decimals)),
      side,
      triggerPrice: String(params.limitPrice),
      leverage: params.leverage != null ? String(params.leverage) : undefined,
      sizeUsdDelta: params.sizeUsd != null ? String(params.sizeUsd) : undefined,
      walletAddress,
    });

    if (!resp.serializedTxBase64) {
      throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "No transaction returned for limit order");
    }

    const sig = await signAndExecute(secretKey, resp.serializedTxBase64, "create-limit-order");
    return {
      positionPubkey: resp.positionPubkey ?? "",
      signature: sig,
      type: "limit-order",
      quote: resp.quote as unknown as Record<string, string>,
    };
  }

  // Market order path
  const tpsl = buildTpsl(params.tp, params.sl, inputAsset.mint);

  const resp = await perpsIncreasePosition({
    asset: asset.mint,
    inputToken: inputAsset.mint,
    inputTokenAmount: String(Math.round(params.amountUsd * 10 ** inputAsset.decimals)),
    side,
    maxSlippageBps: slippage,
    leverage: params.leverage != null ? String(params.leverage) : undefined,
    sizeUsdDelta: params.sizeUsd != null ? String(params.sizeUsd) : undefined,
    walletAddress,
    tpsl,
  });

  const sig = await signAndExecute(secretKey, resp.serializedTxBase64, "increase-position");
  return {
    positionPubkey: resp.positionPubkey,
    signature: sig,
    type: "market-order",
    quote: resp.quote as unknown as Record<string, string>,
  };
}

export async function closePerpsPosition(
  secretKey: Uint8Array,
  params: {
    positionPubkey: string;
    receiveToken?: string;
    sizeUsd?: number;
    slippageBps?: number;
  },
): Promise<{ signature: string; quote: Record<string, string> }> {
  const receiveAsset = resolvePerpsAsset(params.receiveToken ?? "SOL");
  const entirePosition = params.sizeUsd == null;

  const resp = await perpsDecreasePosition({
    positionPubkey: params.positionPubkey,
    receiveToken: receiveAsset.mint,
    sizeUsdDelta: params.sizeUsd != null ? String(params.sizeUsd) : undefined,
    entirePosition,
    maxSlippageBps: String(params.slippageBps ?? 200),
  });

  const sig = await signAndExecute(secretKey, resp.serializedTxBase64, entirePosition ? "close-position" : "decrease-position");
  return { signature: sig, quote: resp.quote as unknown as Record<string, string> };
}

export async function closeAllPerpsPositions(
  secretKey: Uint8Array,
): Promise<string[]> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const resp = await perpsCloseAll(keypair.publicKey.toBase58());

  const signatures: string[] = [];
  for (const item of resp.serializedTxs) {
    const sig = await signAndExecute(secretKey, item.serializedTxBase64, "close-position");
    signatures.push(sig);
  }
  return signatures;
}

// --- Limit order management ---

export async function updatePerpsLimitOrder(
  secretKey: Uint8Array,
  positionRequestPubkey: string,
  triggerPrice: number,
): Promise<string> {
  const resp = await perpsUpdateLimitOrder({
    positionRequestPubkey,
    triggerPrice: String(triggerPrice),
  });
  if (!resp.serializedTxBase64) {
    throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "No transaction returned for limit order update");
  }
  return signAndExecute(secretKey, resp.serializedTxBase64, "update-limit-order");
}

export async function cancelPerpsLimitOrder(
  secretKey: Uint8Array,
  positionRequestPubkey: string,
): Promise<string> {
  const resp = await perpsCancelLimitOrder(positionRequestPubkey);
  return signAndExecute(secretKey, resp.serializedTxBase64, "cancel-limit-order");
}

// --- TP/SL management ---

export async function setPerpsTPSL(
  secretKey: Uint8Array,
  positionPubkey: string,
  opts: { tp?: number; sl?: number; receiveToken?: string },
): Promise<{ signatures: string[] }> {
  const keypair = Keypair.fromSecretKey(secretKey);
  const receiveAsset = resolvePerpsAsset(opts.receiveToken ?? "SOL");

  const tpsl: Array<{
    receiveToken: string;
    triggerPrice: string;
    requestType: string;
    entirePosition: boolean;
  }> = [];

  if (opts.tp != null) {
    tpsl.push({ receiveToken: receiveAsset.mint, triggerPrice: String(opts.tp), requestType: "tp", entirePosition: true });
  }
  if (opts.sl != null) {
    tpsl.push({ receiveToken: receiveAsset.mint, triggerPrice: String(opts.sl), requestType: "sl", entirePosition: true });
  }

  if (tpsl.length === 0) {
    throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, "At least one of --tp or --sl must be provided");
  }

  const resp = await perpsSetTpsl({
    walletAddress: keypair.publicKey.toBase58(),
    positionPubkey,
    tpsl,
  });

  const sig = await signAndExecute(secretKey, resp.serializedTxBase64, "set-tpsl");
  return { signatures: [sig] };
}

export async function cancelPerpsTPSL(
  secretKey: Uint8Array,
  positionRequestPubkey: string,
): Promise<string> {
  const resp = await perpsCancelTpsl(positionRequestPubkey);
  return signAndExecute(secretKey, resp.serializedTxBase64, "cancel-tpsl");
}

// --- Internals ---

function normalizeSide(input: string): string {
  const s = input.toLowerCase();
  if (s === "long" || s === "buy") return "long";
  if (s === "short" || s === "sell") return "short";
  throw new EchoError(ErrorCodes.SOLANA_ORDER_FAILED, `Invalid side: ${input}. Use long/short or buy/sell.`);
}

function buildTpsl(
  tp: number | undefined,
  sl: number | undefined,
  receiveToken: string,
): Array<{ receiveToken: string; triggerPrice: string; requestType: string }> | undefined {
  if (tp == null && sl == null) return undefined;
  const result: Array<{ receiveToken: string; triggerPrice: string; requestType: string }> = [];
  if (tp != null) result.push({ receiveToken, triggerPrice: String(tp), requestType: "tp" });
  if (sl != null) result.push({ receiveToken, triggerPrice: String(sl), requestType: "sl" });
  return result;
}
