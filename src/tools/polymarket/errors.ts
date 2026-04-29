/**
 * Polymarket error utilities — transport error remapping + domain error mapping.
 */

import { VexError, ErrorCodes } from "../../errors.js";

/** Remap generic HTTP transport errors to Polymarket-scoped error codes. */
export function mapPolyTransportError(err: unknown): never {
  if (err instanceof VexError && err.code.startsWith("POLYMARKET_")) {
    throw err;
  }
  if (err instanceof VexError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new VexError(ErrorCodes.POLYMARKET_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof VexError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new VexError(ErrorCodes.POLYMARKET_API_ERROR, err.message, err.hint);
  }
  throw err;
}

function withMeta(error: VexError, retryable: boolean): VexError {
  error.retryable = retryable;
  return error;
}

/** Map Polymarket API HTTP errors to domain-specific VexError. */
export function mapPolyApiError(status: number, message: string, service: string): VexError {
  if (status === 429) {
    return withMeta(
      new VexError(ErrorCodes.POLYMARKET_RATE_LIMITED, `Polymarket ${service} rate limit: ${message}`, "Retry with backoff."),
      true,
    );
  }
  if (status === 401) {
    return withMeta(
      new VexError(ErrorCodes.POLYMARKET_AUTH_FAILED, `Polymarket ${service} auth failed: ${message}`, "Run 'vex polymarket setup --yes' to configure API key."),
      false,
    );
  }
  if (status === 404) {
    return withMeta(
      new VexError(ErrorCodes.POLYMARKET_MARKET_NOT_FOUND, `Polymarket ${service}: ${message}`),
      false,
    );
  }
  if (status === 503) {
    return withMeta(
      new VexError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service} unavailable: ${message}`, "Trading may be disabled. Check polymarket.com for updates."),
      true,
    );
  }
  if (status >= 500) {
    return withMeta(
      new VexError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service} server error: ${message}`, "Retry with backoff."),
      true,
    );
  }
  if (status === 400) {
    if (message.toLowerCase().includes("banned") || message.toLowerCase().includes("closed only")) {
      return withMeta(
        new VexError(ErrorCodes.POLYMARKET_ORDER_FAILED, `Polymarket ${service}: ${message}`),
        false,
      );
    }
    return withMeta(
      new VexError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service}: ${message}`),
      false,
    );
  }
  return withMeta(
    new VexError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service}: ${message}`),
    false,
  );
}
