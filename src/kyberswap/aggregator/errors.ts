/**
 * KyberSwap Aggregator error mapping.
 *
 * Maps HTTP status codes and KyberSwap-specific error codes
 * to structured EchoError instances with retryable flags.
 */

import { EchoError, ErrorCodes } from "../../errors.js";

function withMeta(error: EchoError, retryable: boolean, externalName?: string): EchoError {
  error.retryable = retryable;
  if (externalName) error.externalName = externalName;
  return error;
}

/**
 * Map KyberSwap Aggregator API response to EchoError.
 *
 * @param status - HTTP status code
 * @param code - KyberSwap error code from response JSON (e.g. 4001, 4008)
 * @param message - Error message from response
 * @param requestId - KyberSwap requestId for debug
 */
export function mapAggregatorError(status: number, code: number | null, message: string, requestId?: string): EchoError {
  const suffix = requestId ? ` [requestId: ${requestId}]` : "";

  if (status === 429) {
    return withMeta(
      new EchoError(ErrorCodes.KYBER_RATE_LIMITED, `KyberSwap rate limit exceeded${suffix}`, "Retry with backoff."),
      true, "429",
    );
  }

  if (code !== null) {
    switch (code) {
      case 4001:
      case 4002:
        return withMeta(
          new EchoError(ErrorCodes.KYBER_MALFORMED_PARAMS, `${message}${suffix}`, "Check request parameters."),
          false, String(code),
        );
      case 4005:
      case 4007:
        return withMeta(
          new EchoError(ErrorCodes.KYBER_FEE_EXCEEDS_AMOUNT, `${message}${suffix}`, "Reduce fee amount or increase swap amount."),
          false, String(code),
        );
      case 4008:
      case 4010:
        return withMeta(
          new EchoError(ErrorCodes.KYBER_ROUTE_NOT_FOUND, `${message}${suffix}`, "Try different tokens, amount, or chain."),
          false, String(code),
        );
      case 4009:
        return withMeta(
          new EchoError(ErrorCodes.KYBER_AMOUNT_TOO_LARGE, `${message}${suffix}`, "Reduce the swap amount."),
          false, String(code),
        );
      case 4011:
        return withMeta(
          new EchoError(ErrorCodes.KYBER_TOKEN_NOT_FOUND, `${message}${suffix}`, "Verify the token address."),
          false, String(code),
        );
      case 4221:
        return withMeta(
          new EchoError(ErrorCodes.KYBER_WETH_NOT_CONFIGURED, `${message}${suffix}`, "WETH is not configured on this network."),
          false, String(code),
        );
    }
  }

  if (status >= 500) {
    return withMeta(
      new EchoError(ErrorCodes.KYBER_API_ERROR, `KyberSwap server error: ${message}${suffix}`, "Retry with backoff."),
      true, code != null ? String(code) : undefined,
    );
  }

  return withMeta(
    new EchoError(ErrorCodes.KYBER_API_ERROR, `${message}${suffix}`),
    false, code != null ? String(code) : undefined,
  );
}
