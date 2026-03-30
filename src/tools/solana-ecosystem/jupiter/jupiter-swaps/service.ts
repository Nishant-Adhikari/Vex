/**
 * High-level Jupiter Swap API V2 service.
 * Resolves token metadata, converts UI amounts, and preserves the full wire response.
 */

import { Keypair } from "@solana/web3.js";
import { EchoError, ErrorCodes } from "../../../../errors.js";
import { requireJupiterResolvedToken } from "../jupiter-tokens/service.js";
import { deserializeVersionedTx, signVersionedTx } from "../../shared/solana-transaction.js";
import { solanaExplorerUrl, tokenAmountToUi, uiToTokenAmount } from "../../shared/solana-validation.js";
import { jupiterSwapBuild, jupiterSwapExecute, jupiterSwapOrder } from "./client.js";
import type {
  JupiterSwapBuildOptions,
  JupiterSwapBuildResponse,
  JupiterSwapBuildSummary,
  JupiterSwapExecutionResult,
  JupiterSwapOrderOptions,
  JupiterSwapOrderResponse,
  JupiterSwapQuoteSummary,
} from "./types.js";
import type { TokenMetadata } from "../../shared/types.js";

export interface SwapOptions extends JupiterSwapOrderOptions {}

function formatUiAmount(rawAmount: string, decimals: number): string {
  return tokenAmountToUi(rawAmount, decimals).toString();
}

function toPriceImpactPct(raw: JupiterSwapOrderResponse): string {
  if (raw.priceImpactPct != null) return raw.priceImpactPct;
  if (raw.priceImpact != null) return String(raw.priceImpact * 100);
  return "0";
}

async function resolveSwapTokens(
  inputSymbolOrMint: string,
  outputSymbolOrMint: string,
): Promise<{ inputToken: TokenMetadata; outputToken: TokenMetadata }> {
  const inputToken = await requireJupiterResolvedToken(inputSymbolOrMint);
  const outputToken = await requireJupiterResolvedToken(outputSymbolOrMint);

  return { inputToken, outputToken };
}

function summarizeOrder(
  raw: JupiterSwapOrderResponse,
  inputToken: TokenMetadata,
  outputToken: TokenMetadata,
): JupiterSwapQuoteSummary {
  return {
    inputToken,
    outputToken,
    inputAmount: formatUiAmount(raw.inAmount, inputToken.decimals),
    outputAmount: formatUiAmount(raw.outAmount, outputToken.decimals),
    inputAmountRaw: raw.inAmount,
    outputAmountRaw: raw.outAmount,
    otherAmountThreshold: raw.otherAmountThreshold,
    priceImpact: raw.priceImpact,
    priceImpactPct: toPriceImpactPct(raw),
    route: raw.routePlan.map((step) => step.swapInfo.label),
    routePlan: raw.routePlan,
    provider: raw.router ? `jupiter-swap-v2 (${raw.router})` : "jupiter-swap-v2",
    router: raw.router,
    mode: raw.mode,
    slippageBps: raw.slippageBps,
    feeBps: raw.feeBps,
    feeMint: raw.feeMint,
    platformFee: raw.platformFee,
    gasless: raw.gasless,
    requestId: raw.requestId,
    transaction: raw.transaction,
    lastValidBlockHeight: raw.lastValidBlockHeight,
    raw,
  };
}

function summarizeBuild(
  raw: JupiterSwapBuildResponse,
  inputToken: TokenMetadata,
  outputToken: TokenMetadata,
): JupiterSwapBuildSummary {
  return {
    inputToken,
    outputToken,
    inputAmount: formatUiAmount(raw.inAmount, inputToken.decimals),
    outputAmount: formatUiAmount(raw.outAmount, outputToken.decimals),
    inputAmountRaw: raw.inAmount,
    outputAmountRaw: raw.outAmount,
    otherAmountThreshold: raw.otherAmountThreshold,
    route: raw.routePlan.map((step) => step.swapInfo.label),
    routePlan: raw.routePlan,
    slippageBps: raw.slippageBps,
    computeBudgetInstructionCount: raw.computeBudgetInstructions.length,
    setupInstructionCount: raw.setupInstructions.length,
    otherInstructionCount: raw.otherInstructions.length,
    hasCleanupInstruction: raw.cleanupInstruction != null,
    lookupTableCount: Object.keys(raw.addressesByLookupTableAddress ?? {}).length,
    raw,
  };
}

function ensureExecutableOrder(raw: JupiterSwapOrderResponse): string {
  if (raw.transaction) return raw.transaction;

  const message = raw.errorMessage ?? raw.error ?? "No transaction returned from Jupiter /order.";
  throw new EchoError(
    ErrorCodes.SOLANA_SWAP_FAILED,
    raw.errorCode != null ? `${message} (errorCode ${raw.errorCode})` : message,
  );
}

export async function getJupiterSwapQuote(
  inputSymbolOrMint: string,
  outputSymbolOrMint: string,
  uiAmount: number,
  opts: SwapOptions = {},
): Promise<{ quote: JupiterSwapQuoteSummary; raw: JupiterSwapOrderResponse }> {
  const { inputToken, outputToken } = await resolveSwapTokens(inputSymbolOrMint, outputSymbolOrMint);
  const atomicAmount = uiToTokenAmount(uiAmount, inputToken.decimals);

  const raw = await jupiterSwapOrder({
    inputMint: inputToken.address,
    outputMint: outputToken.address,
    amount: atomicAmount.toString(),
    ...opts,
  });

  if (raw.errorCode != null && raw.transaction === "") {
    const message = raw.errorMessage ?? raw.error ?? `Quote error code ${raw.errorCode}`;
    throw new EchoError(ErrorCodes.SOLANA_QUOTE_FAILED, message);
  }

  return { quote: summarizeOrder(raw, inputToken, outputToken), raw };
}

export async function buildSwapTransaction(
  inputSymbolOrMint: string,
  outputSymbolOrMint: string,
  uiAmount: number,
  opts: JupiterSwapBuildOptions,
): Promise<{ build: JupiterSwapBuildSummary; raw: JupiterSwapBuildResponse }> {
  const { inputToken, outputToken } = await resolveSwapTokens(inputSymbolOrMint, outputSymbolOrMint);
  const atomicAmount = uiToTokenAmount(uiAmount, inputToken.decimals);

  const raw = await jupiterSwapBuild({
    inputMint: inputToken.address,
    outputMint: outputToken.address,
    amount: atomicAmount.toString(),
    ...opts,
  });

  return { build: summarizeBuild(raw, inputToken, outputToken), raw };
}

export async function executeJupiterSwap(
  inputSymbolOrMint: string,
  outputSymbolOrMint: string,
  uiAmount: number,
  secretKey: Uint8Array,
  opts: SwapOptions = {},
): Promise<JupiterSwapExecutionResult> {
  const { inputToken, outputToken } = await resolveSwapTokens(inputSymbolOrMint, outputSymbolOrMint);
  const atomicAmount = uiToTokenAmount(uiAmount, inputToken.decimals);
  const keypair = Keypair.fromSecretKey(secretKey);
  const taker = keypair.publicKey.toBase58();

  if (opts.taker && opts.taker !== taker) {
    throw new EchoError(
      ErrorCodes.SIGNER_MISMATCH,
      `Swap taker mismatch: expected ${taker}, received ${opts.taker}.`,
    );
  }

  const order = await jupiterSwapOrder({
    inputMint: inputToken.address,
    outputMint: outputToken.address,
    amount: atomicAmount.toString(),
    ...opts,
    taker,
  });

  const transactionBase64 = ensureExecutableOrder(order);
  const tx = deserializeVersionedTx(transactionBase64);
  signVersionedTx(tx, [keypair]);
  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");

  const execute = await jupiterSwapExecute({
    signedTransaction,
    requestId: order.requestId,
    lastValidBlockHeight: order.lastValidBlockHeight,
  });

  if (execute.status !== "Success") {
    throw new EchoError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      `Swap failed (code ${execute.code}): ${execute.error ?? "unknown error"}`,
    );
  }

  const inputAmountRaw = execute.inputAmountResult || order.inAmount;
  const outputAmountRaw = execute.outputAmountResult || order.outAmount;

  return {
    signature: execute.signature,
    explorerUrl: solanaExplorerUrl(execute.signature),
    inputAmount: formatUiAmount(inputAmountRaw, inputToken.decimals),
    outputAmount: formatUiAmount(outputAmountRaw, outputToken.decimals),
    inputAmountRaw,
    outputAmountRaw,
    inputToken,
    outputToken,
    router: order.router,
    mode: order.mode,
    feeBps: order.feeBps,
    feeMint: order.feeMint,
    platformFee: order.platformFee,
    gasless: order.gasless,
    requestId: order.requestId,
    lastValidBlockHeight: order.lastValidBlockHeight,
    routePlan: order.routePlan,
    order,
    execute,
  };
}

export const getSwapQuote = getJupiterSwapQuote;
export const getSwapBuild = buildSwapTransaction;
export const executeSwap = executeJupiterSwap;
