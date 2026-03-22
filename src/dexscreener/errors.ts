/**
 * DexScreener error mapping.
 *
 * Maps HTTP status codes to typed EchoError with DEXSCREENER_* codes.
 */

import { EchoError, ErrorCodes } from "../errors.js";

export function mapDexScreenerError(status: number, message?: string): EchoError {
  const msg = message ?? `DexScreener API returned HTTP ${status}`;

  if (status === 429) {
    const err = new EchoError(ErrorCodes.DEXSCREENER_RATE_LIMITED, msg, "Rate limit is 60 req/min for most endpoints, 300 req/min for search/pairs/tokens. Wait and retry.");
    err.retryable = true;
    return err;
  }

  if (status === 404) {
    return new EchoError(ErrorCodes.DEXSCREENER_NOT_FOUND, msg, "Check that the chainId and address are correct.");
  }

  if (status >= 500) {
    const err = new EchoError(ErrorCodes.DEXSCREENER_API_ERROR, msg, "DexScreener server error. Try again later.");
    err.retryable = true;
    return err;
  }

  return new EchoError(ErrorCodes.DEXSCREENER_API_ERROR, msg);
}

export function mapTransportError(err: unknown): never {
  if (err instanceof EchoError && err.code.startsWith("DEXSCREENER_")) {
    throw err;
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new EchoError(ErrorCodes.DEXSCREENER_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new EchoError(ErrorCodes.DEXSCREENER_API_ERROR, err.message, err.hint);
  }
  throw err;
}
