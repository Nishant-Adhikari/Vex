/**
 * Validation helpers for Jupiter Token Content API.
 */

import { EchoError, ErrorCodes } from "../../../../../errors.js";
import { getJupiterHeaders, requireJupiterApiKey } from "../../../shared/jupiter-auth.js";
import { validateSolanaAddress } from "../../../shared/solana-validation.js";
import { normalizeMintList, validateJupiterMintList } from "../validation.js";
import type { JupiterTokenContentFeedParams } from "./types.js";

export function requireJupiterContentApiKey(): string {
  return requireJupiterApiKey({
    feature: "Jupiter Token Content API",
    errorCode: ErrorCodes.HTTP_REQUEST_FAILED,
  });
}

export function getJupiterContentHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return getJupiterHeaders(extraHeaders, {
    feature: "Jupiter Token Content API",
    errorCode: ErrorCodes.HTTP_REQUEST_FAILED,
  });
}

export function validateJupiterContentMints(mints: string[]): string[] {
  return validateJupiterMintList(mints, 50, "mints");
}

export function normalizeJupiterContentMints(mints: string[]): string {
  return normalizeMintList(validateJupiterContentMints(mints));
}

export function validateJupiterContentFeedParams(
  params: JupiterTokenContentFeedParams,
): JupiterTokenContentFeedParams {
  const mint = validateSolanaAddress(params.mint);

  if (params.page != null && (!Number.isInteger(params.page) || params.page < 1)) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `Invalid content feed page: ${params.page}`,
      "page must be an integer greater than or equal to 1.",
    );
  }

  if (params.limit != null && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100)) {
    throw new EchoError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `Invalid content feed limit: ${params.limit}`,
      "limit must be an integer between 1 and 100.",
    );
  }

  return {
    ...params,
    mint,
  };
}
