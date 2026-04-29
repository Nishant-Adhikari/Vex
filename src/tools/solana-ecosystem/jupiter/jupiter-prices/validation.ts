/**
 * Validation helpers for Jupiter Price API V3.
 */

import { VexError, ErrorCodes } from "../../../../errors.js";
import { getJupiterHeaders, requireJupiterApiKey, type JupiterApiKeyOptions } from "../../shared/jupiter-auth.js";
import { validateSolanaAddress } from "../../shared/solana-validation.js";
import type { JupiterPriceRequestParams } from "./types.js";

const JUPITER_PRICE_MAX_IDS = 50;

export function requireJupiterPriceApiKey(options: JupiterApiKeyOptions = {}): string {
  return requireJupiterApiKey({
    feature: "Jupiter Price API V3",
    ...options,
  });
}

export function getJupiterPriceHeaders(
  extraHeaders: Record<string, string> = {},
  options: JupiterApiKeyOptions = {},
): Record<string, string> {
  return getJupiterHeaders(extraHeaders, {
    feature: "Jupiter Price API V3",
    ...options,
  });
}

export function validateJupiterPriceMintList(mints: string[], fieldName = "ids"): string[] {
  if (mints.length === 0) {
    throw new VexError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `${fieldName} must contain at least one mint address.`,
    );
  }

  const normalized = Array.from(new Set(mints.map((mint) => validateSolanaAddress(mint))));
  if (normalized.length > JUPITER_PRICE_MAX_IDS) {
    throw new VexError(
      ErrorCodes.HTTP_REQUEST_FAILED,
      `${fieldName} supports at most ${JUPITER_PRICE_MAX_IDS} mint addresses.`,
    );
  }

  return normalized;
}

export function validateJupiterPriceRequestParams(
  params: JupiterPriceRequestParams,
): JupiterPriceRequestParams {
  return {
    ids: validateJupiterPriceMintList(params.ids),
  };
}

export function normalizeJupiterPriceMintList(mints: string[]): string {
  return validateJupiterPriceMintList(mints).join(",");
}

