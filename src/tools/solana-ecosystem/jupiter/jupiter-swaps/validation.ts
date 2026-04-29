/**
 * Validation and auth helpers for Jupiter Swap API V2.
 */

import { VexError, ErrorCodes } from "../../../../errors.js";
import {
  requireJupiterApiKey as requireSharedJupiterApiKey,
  resolveJupiterApiKey as resolveSharedJupiterApiKey,
} from "../../shared/jupiter-auth.js";
import { validateSolanaAddress } from "../../shared/solana-validation.js";
import type {
  JupiterSwapBuildParams,
  JupiterSwapExecuteRequest,
  JupiterSwapOrderParams,
} from "./types.js";

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function assertNumberInRange(
  name: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new VexError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${value}`,
      `${name} must be between ${min} and ${max}.`,
    );
  }
}

function assertPositiveIntegerString(name: string, value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new VexError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${value}`,
      `${name} must be a base-10 integer string in smallest units.`,
    );
  }

  if (BigInt(value) <= 0n) {
    throw new VexError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid ${name}: ${value}`,
      `${name} must be greater than 0.`,
    );
  }
}

function assertRequiredTogether(
  leftName: string,
  leftValue: unknown,
  rightName: string,
  rightValue: unknown,
): void {
  if (Boolean(leftValue) !== Boolean(rightValue)) {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      `${leftName} and ${rightName} must be provided together.`,
    );
  }
}

function assertMutuallyExclusive(
  leftName: string,
  leftValue: unknown,
  rightName: string,
  rightValue: unknown,
): void {
  if (leftValue && rightValue) {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      `${leftName} and ${rightName} are mutually exclusive.`,
    );
  }
}

function normalizeCsvValue(value?: string | string[]): string | undefined {
  if (!isDefined(value)) return undefined;
  if (Array.isArray(value)) {
    const normalized = value.map((item) => item.trim()).filter(Boolean);
    return normalized.length > 0 ? normalized.join(",") : undefined;
  }
  const normalized = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(",") : undefined;
}

export function resolveJupiterApiKey(): string {
  return resolveSharedJupiterApiKey();
}

export function requireJupiterApiKey(): string {
  return requireSharedJupiterApiKey({
    feature: "Jupiter Swap API V2",
    errorCode: ErrorCodes.SOLANA_SWAP_FAILED,
  });
}

export function getJupiterSwapHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    "x-api-key": requireJupiterApiKey(),
    ...extraHeaders,
  };
}

export function validateJupiterSwapOrderParams(params: JupiterSwapOrderParams): void {
  validateSolanaAddress(params.inputMint);
  validateSolanaAddress(params.outputMint);
  assertPositiveIntegerString("amount", params.amount);

  if (params.taker) validateSolanaAddress(params.taker);
  if (params.receiver) validateSolanaAddress(params.receiver);
  if (params.payer) validateSolanaAddress(params.payer);

  if (params.swapMode && params.swapMode !== "ExactIn") {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      `Unsupported swapMode: ${params.swapMode}`,
      "Jupiter Swap API V2 currently supports only ExactIn.",
    );
  }

  if (isDefined(params.slippageBps)) assertNumberInRange("slippageBps", params.slippageBps, 0, 10_000);
  if (isDefined(params.referralFee)) assertNumberInRange("referralFee", params.referralFee, 50, 255);
  if (isDefined(params.priorityFeeLamports) && params.priorityFeeLamports < 0) {
    throw new VexError(ErrorCodes.INVALID_AMOUNT, `Invalid priorityFeeLamports: ${params.priorityFeeLamports}`);
  }
  if (isDefined(params.jitoTipLamports) && params.jitoTipLamports < 0) {
    throw new VexError(ErrorCodes.INVALID_AMOUNT, `Invalid jitoTipLamports: ${params.jitoTipLamports}`);
  }

  assertRequiredTogether("referralAccount", params.referralAccount, "referralFee", params.referralFee);
}

export function validateJupiterSwapBuildParams(params: JupiterSwapBuildParams): void {
  validateSolanaAddress(params.inputMint);
  validateSolanaAddress(params.outputMint);
  validateSolanaAddress(params.taker);
  assertPositiveIntegerString("amount", params.amount);

  if (params.mode && params.mode !== "fast") {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      `Unsupported build mode: ${params.mode}`,
      "Supported build mode: fast.",
    );
  }

  if (isDefined(params.slippageBps)) assertNumberInRange("slippageBps", params.slippageBps, 0, 10_000);
  if (isDefined(params.platformFeeBps)) assertNumberInRange("platformFeeBps", params.platformFeeBps, 0, 10_000);
  if (isDefined(params.maxAccounts)) assertNumberInRange("maxAccounts", params.maxAccounts, 1, 64);
  if (isDefined(params.blockhashSlotsToExpiry)) {
    assertNumberInRange("blockhashSlotsToExpiry", params.blockhashSlotsToExpiry, 1, 300);
  }

  if (params.payer) validateSolanaAddress(params.payer);
  if (params.feeAccount) validateSolanaAddress(params.feeAccount);
  if (params.destinationTokenAccount) validateSolanaAddress(params.destinationTokenAccount);
  if (params.nativeDestinationAccount) validateSolanaAddress(params.nativeDestinationAccount);

  assertMutuallyExclusive("dexes", params.dexes, "excludeDexes", params.excludeDexes);
  assertMutuallyExclusive(
    "destinationTokenAccount",
    params.destinationTokenAccount,
    "nativeDestinationAccount",
    params.nativeDestinationAccount,
  );
  if ((params.platformFeeBps ?? 0) > 0 && !params.feeAccount) {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      "feeAccount is required when platformFeeBps is positive.",
    );
  }
}

export function validateJupiterSwapExecuteRequest(request: JupiterSwapExecuteRequest): void {
  if (!request.signedTransaction.trim()) {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      "signedTransaction is required for /execute.",
    );
  }
  if (!request.requestId.trim()) {
    throw new VexError(
      ErrorCodes.SOLANA_SWAP_FAILED,
      "requestId is required for /execute.",
    );
  }
}

export function normalizeOrderQueryParams(params: JupiterSwapOrderParams): Record<string, string> {
  validateJupiterSwapOrderParams(params);

  const query: Record<string, string | undefined> = {
    inputMint: validateSolanaAddress(params.inputMint),
    outputMint: validateSolanaAddress(params.outputMint),
    amount: params.amount,
    taker: params.taker ? validateSolanaAddress(params.taker) : undefined,
    receiver: params.receiver ? validateSolanaAddress(params.receiver) : undefined,
    swapMode: params.swapMode,
    slippageBps: isDefined(params.slippageBps) ? String(params.slippageBps) : undefined,
    referralAccount: params.referralAccount ? validateSolanaAddress(params.referralAccount) : undefined,
    referralFee: isDefined(params.referralFee) ? String(params.referralFee) : undefined,
    payer: params.payer ? validateSolanaAddress(params.payer) : undefined,
    priorityFeeLamports: isDefined(params.priorityFeeLamports) ? String(params.priorityFeeLamports) : undefined,
    jitoTipLamports: isDefined(params.jitoTipLamports) ? String(params.jitoTipLamports) : undefined,
    broadcastFeeType: params.broadcastFeeType,
    excludeRouters: normalizeCsvValue(params.excludeRouters),
    excludeDexes: normalizeCsvValue(params.excludeDexes),
  };

  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function normalizeBuildQueryParams(params: JupiterSwapBuildParams): Record<string, string> {
  validateJupiterSwapBuildParams(params);

  const query: Record<string, string | undefined> = {
    inputMint: validateSolanaAddress(params.inputMint),
    outputMint: validateSolanaAddress(params.outputMint),
    amount: params.amount,
    taker: validateSolanaAddress(params.taker),
    slippageBps: isDefined(params.slippageBps) ? String(params.slippageBps) : undefined,
    mode: params.mode,
    dexes: normalizeCsvValue(params.dexes),
    excludeDexes: normalizeCsvValue(params.excludeDexes),
    platformFeeBps: isDefined(params.platformFeeBps) ? String(params.platformFeeBps) : undefined,
    feeAccount: params.feeAccount ? validateSolanaAddress(params.feeAccount) : undefined,
    maxAccounts: isDefined(params.maxAccounts) ? String(params.maxAccounts) : undefined,
    payer: params.payer ? validateSolanaAddress(params.payer) : undefined,
    wrapAndUnwrapSol: isDefined(params.wrapAndUnwrapSol) ? String(params.wrapAndUnwrapSol) : undefined,
    destinationTokenAccount: params.destinationTokenAccount
      ? validateSolanaAddress(params.destinationTokenAccount)
      : undefined,
    nativeDestinationAccount: params.nativeDestinationAccount
      ? validateSolanaAddress(params.nativeDestinationAccount)
      : undefined,
    blockhashSlotsToExpiry: isDefined(params.blockhashSlotsToExpiry)
      ? String(params.blockhashSlotsToExpiry)
      : undefined,
  };

  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
