/**
 * Polymarket error utilities — transport error remapping + domain error mapping.
 */

import { EchoError, ErrorCodes } from "../../errors.js";

/** Remap generic HTTP transport errors to Polymarket-scoped error codes. */
export function mapPolyTransportError(err: unknown): never {
  if (err instanceof EchoError && err.code.startsWith("POLYMARKET_")) {
    throw err;
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new EchoError(ErrorCodes.POLYMARKET_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new EchoError(ErrorCodes.POLYMARKET_API_ERROR, err.message, err.hint);
  }
  throw err;
}

function withMeta(error: EchoError, retryable: boolean): EchoError {
  error.retryable = retryable;
  return error;
}

/** Map Polymarket API HTTP errors to domain-specific EchoError. */
export function mapPolyApiError(status: number, message: string, service: string): EchoError {
  if (status === 429) {
    return withMeta(
      new EchoError(ErrorCodes.POLYMARKET_RATE_LIMITED, `Polymarket ${service} rate limit: ${message}`, "Retry with backoff."),
      true,
    );
  }
  if (status === 401) {
    return withMeta(
      new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, `Polymarket ${service} auth failed: ${message}`, "Run 'echoclaw polymarket setup --yes' to configure API key."),
      false,
    );
  }
  if (status === 404) {
    return withMeta(
      new EchoError(ErrorCodes.POLYMARKET_MARKET_NOT_FOUND, `Polymarket ${service}: ${message}`),
      false,
    );
  }
  if (status === 503) {
    return withMeta(
      new EchoError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service} unavailable: ${message}`, "Trading may be disabled. Check polymarket.com for updates."),
      true,
    );
  }
  if (status >= 500) {
    return withMeta(
      new EchoError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service} server error: ${message}`, "Retry with backoff."),
      true,
    );
  }
  if (status === 400) {
    if (message.toLowerCase().includes("banned") || message.toLowerCase().includes("closed only")) {
      return withMeta(
        new EchoError(ErrorCodes.POLYMARKET_ORDER_FAILED, `Polymarket ${service}: ${message}`),
        false,
      );
    }
    return withMeta(
      new EchoError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service}: ${message}`),
      false,
    );
  }
  return withMeta(
    new EchoError(ErrorCodes.POLYMARKET_API_ERROR, `Polymarket ${service}: ${message}`),
    false,
  );
}
