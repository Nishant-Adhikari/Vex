/**
 * KyberSwap ZaaS error mapping.
 */

import { EchoError, ErrorCodes } from "../../../errors.js";

function withMeta(error: EchoError, retryable: boolean, externalName?: string): EchoError {
  error.retryable = retryable;
  if (externalName) error.externalName = externalName;
  return error;
}

export function mapZaasError(status: number, rpcCode: number | null, message: string): EchoError {
  if (status === 429) {
    return withMeta(
      new EchoError(ErrorCodes.KYBER_RATE_LIMITED, `ZaaS rate limit: ${message}`, "Rate limit is 10 req/10s. Retry with backoff."),
      true, "429",
    );
  }
  if (status === 400) {
    return withMeta(
      new EchoError(ErrorCodes.KYBER_MALFORMED_PARAMS, `ZaaS validation: ${message}`),
      false, rpcCode != null ? String(rpcCode) : undefined,
    );
  }
  if (status === 404) {
    return withMeta(
      new EchoError(ErrorCodes.KYBER_ZAP_ROUTE_NOT_FOUND, `ZaaS route not found: ${message}`, "Check pool, tokens, and DEX."),
      false, rpcCode != null ? String(rpcCode) : undefined,
    );
  }
  if (status >= 500) {
    return withMeta(
      new EchoError(ErrorCodes.KYBER_API_ERROR, `ZaaS server error: ${message}`, "Retry with backoff."),
      true,
    );
  }
  return withMeta(
    new EchoError(ErrorCodes.KYBER_API_ERROR, `ZaaS error: ${message}`),
    false,
  );
}
