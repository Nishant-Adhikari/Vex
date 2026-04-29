/**
 * Validation and auth helpers for Jupiter Lend Earn REST endpoints.
 */

import { VexError, ErrorCodes } from "../../../../../errors.js";
import {
  requireJupiterApiKey as requireSharedJupiterApiKey,
  resolveJupiterApiKey as resolveSharedJupiterApiKey,
} from "../../../shared/jupiter-auth.js";
import { validateSolanaAddress } from "../../../shared/solana-validation.js";
import type {
  JupiterLendEarnAmountRequest,
  JupiterLendEarnEarningsParams,
  JupiterLendEarnPositionsParams,
  JupiterLendEarnSharesRequest,
} from "./types.js";

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

function validateAddressList(
  values: string[],
  fieldName: string,
): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new VexError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `${fieldName} must include at least one Solana address.`,
    );
  }

  return values.map((value) => validateSolanaAddress(value));
}

export function resolveJupiterLendApiKey(): string {
  return resolveSharedJupiterApiKey();
}

export function requireJupiterLendApiKey(): string {
  return requireSharedJupiterApiKey({
    feature: "Jupiter Lend Earn API",
    errorCode: ErrorCodes.HTTP_REQUEST_FAILED,
  });
}

export function getJupiterLendHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    "x-api-key": requireJupiterLendApiKey(),
    ...extraHeaders,
  };
}

export function validateJupiterLendAmountRequest(
  request: JupiterLendEarnAmountRequest,
): JupiterLendEarnAmountRequest {
  return {
    asset: validateSolanaAddress(request.asset),
    signer: validateSolanaAddress(request.signer),
    amount: (() => {
      assertPositiveIntegerString("amount", request.amount);
      return request.amount;
    })(),
  };
}

export function validateJupiterLendSharesRequest(
  request: JupiterLendEarnSharesRequest,
): JupiterLendEarnSharesRequest {
  return {
    asset: validateSolanaAddress(request.asset),
    signer: validateSolanaAddress(request.signer),
    shares: (() => {
      assertPositiveIntegerString("shares", request.shares);
      return request.shares;
    })(),
  };
}

export function validateJupiterLendPositionsParams(
  params: JupiterLendEarnPositionsParams,
): JupiterLendEarnPositionsParams {
  return {
    users: validateAddressList(params.users, "users"),
  };
}

export function validateJupiterLendEarningsParams(
  params: JupiterLendEarnEarningsParams,
): JupiterLendEarnEarningsParams {
  return {
    user: validateSolanaAddress(params.user),
    positions: validateAddressList(params.positions, "positions"),
  };
}

export function normalizeJupiterLendUsersQuery(users: string[]): string {
  return validateJupiterLendPositionsParams({ users }).users.join(",");
}

export function normalizeJupiterLendPositionsQuery(positions: string[]): string {
  return validateAddressList(positions, "positions").join(",");
}
