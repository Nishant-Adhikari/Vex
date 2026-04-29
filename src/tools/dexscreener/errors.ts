/**
 * DexScreener error mapping.
 *
 * Maps HTTP status codes to typed VexError with DEXSCREENER_* codes.
 */

import { VexError, ErrorCodes } from "../../errors.js";

export function mapDexScreenerError(status: number, message?: string): VexError {
  const msg = message ?? `DexScreener API returned HTTP ${status}`;

  if (status === 429) {
    const err = new VexError(ErrorCodes.DEXSCREENER_RATE_LIMITED, msg, "Rate limit is 60 req/min for most endpoints, 300 req/min for search/pairs/tokens. Wait and retry.");
    err.retryable = true;
    return err;
  }

  if (status === 404) {
    return new VexError(ErrorCodes.DEXSCREENER_NOT_FOUND, msg, "Check that the chainId and address are correct.");
  }

  if (status >= 500) {
    const err = new VexError(ErrorCodes.DEXSCREENER_API_ERROR, msg, "DexScreener server error. Try again later.");
    err.retryable = true;
    return err;
  }

  return new VexError(ErrorCodes.DEXSCREENER_API_ERROR, msg);
}

export function mapTransportError(err: unknown): never {
  if (err instanceof VexError && err.code.startsWith("DEXSCREENER_")) {
    throw err;
  }
  if (err instanceof VexError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new VexError(ErrorCodes.DEXSCREENER_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof VexError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new VexError(ErrorCodes.DEXSCREENER_API_ERROR, err.message, err.hint);
  }
  throw err;
}
