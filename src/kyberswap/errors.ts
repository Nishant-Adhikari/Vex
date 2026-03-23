/**
 * Shared KyberSwap error utilities.
 *
 * Provides transport error remapping used by all KyberSwap sub-clients.
 */

import { EchoError, ErrorCodes } from "../errors.js";

/** Remap generic HTTP transport errors to KyberSwap-scoped error codes. */
export function mapKyberTransportError(err: unknown): never {
  if (err instanceof EchoError && err.code.startsWith("KYBER_")) {
    throw err;
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new EchoError(ErrorCodes.KYBER_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof EchoError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new EchoError(ErrorCodes.KYBER_API_ERROR, err.message, err.hint);
  }
  throw err;
}
