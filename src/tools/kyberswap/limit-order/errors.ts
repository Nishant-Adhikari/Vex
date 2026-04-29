/**
 * KyberSwap Limit Order error mapping.
 */

import { VexError, ErrorCodes } from "../../../errors.js";

function withMeta(error: VexError, retryable: boolean, externalName?: string): VexError {
  error.retryable = retryable;
  if (externalName) error.externalName = externalName;
  return error;
}

export function mapLimitOrderError(status: number, message: string): VexError {
  if (status === 429) {
    return withMeta(
      new VexError(ErrorCodes.KYBER_RATE_LIMITED, `Limit Order rate limit: ${message}`, "Retry with backoff."),
      true, "429",
    );
  }
  if (status === 404) {
    return withMeta(
      new VexError(ErrorCodes.KYBER_LO_ORDER_NOT_FOUND, `Order not found: ${message}`),
      false,
    );
  }
  if (status === 400) {
    if (message.toLowerCase().includes("signature")) {
      return withMeta(
        new VexError(ErrorCodes.KYBER_LO_SIGNATURE_INVALID, `Invalid signature: ${message}`),
        false,
      );
    }
    if (message.toLowerCase().includes("allowance") || message.toLowerCase().includes("balance")) {
      return withMeta(
        new VexError(ErrorCodes.KYBER_LO_INSUFFICIENT_ALLOWANCE, `Insufficient allowance: ${message}`, "Approve tokens first."),
        false,
      );
    }
    return withMeta(
      new VexError(ErrorCodes.KYBER_MALFORMED_PARAMS, `Limit Order validation: ${message}`),
      false,
    );
  }
  if (status >= 500) {
    return withMeta(
      new VexError(ErrorCodes.KYBER_API_ERROR, `Limit Order server error: ${message}`, "Retry with backoff."),
      true,
    );
  }
  return withMeta(
    new VexError(ErrorCodes.KYBER_API_ERROR, `Limit Order error: ${message}`),
    false,
  );
}
