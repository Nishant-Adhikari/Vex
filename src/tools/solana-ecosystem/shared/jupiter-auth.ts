/**
 * Shared Jupiter auth helpers for all Jupiter shelves.
 */

import { VexError, ErrorCodes } from "../../../errors.js";

export interface JupiterApiKeyOptions {
  feature?: string;
  errorCode?: string;
}

export function resolveJupiterApiKey(): string {
  return process.env.JUPITER_API_KEY?.trim() || "";
}

export function requireJupiterApiKey(options: JupiterApiKeyOptions = {}): string {
  const {
    feature = "Jupiter API",
    errorCode = ErrorCodes.HTTP_REQUEST_FAILED,
  } = options;

  const apiKey = resolveJupiterApiKey();
  if (!apiKey) {
    throw new VexError(
      errorCode,
      `JUPITER_API_KEY is required for ${feature}.`,
      "Generate a key at https://portal.jup.ag and set JUPITER_API_KEY in CONFIG_DIR/.env.",
    );
  }

  return apiKey;
}

export function getJupiterHeaders(
  extraHeaders: Record<string, string> = {},
  options: JupiterApiKeyOptions = {},
): Record<string, string> {
  return {
    "x-api-key": requireJupiterApiKey(options),
    ...extraHeaders,
  };
}
