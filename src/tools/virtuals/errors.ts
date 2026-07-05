/**
 * Virtuals Protocol error mapping.
 *
 * Maps HTTP status codes to typed VexError with VIRTUALS_* codes, mirroring the
 * DexScreener error module — with one deliberate difference: the Virtuals API
 * is unauthenticated + undocumented, so upstream response bodies are HOSTILE
 * input. `mapVirtualsError` therefore NEVER copies upstream text into the
 * error message — messages and hints are fixed, code-keyed strings built only
 * from the numeric status. The caller may log the (bounded) upstream detail as
 * metadata; it must never reach a model-facing surface.
 */

import { VexError, ErrorCodes } from "../../errors.js";

export function mapVirtualsError(status: number): VexError {
  if (status === 429) {
    const err = new VexError(
      ErrorCodes.VIRTUALS_RATE_LIMITED,
      "Virtuals API rate limited (HTTP 429).",
      "Virtuals API is unauthenticated and self-throttled. Wait and retry.",
    );
    err.retryable = true;
    return err;
  }

  if (status === 404) {
    return new VexError(
      ErrorCodes.VIRTUALS_NOT_FOUND,
      "Virtuals agent not found (HTTP 404).",
      "Check that the Virtuals agent id is correct.",
    );
  }

  if (status === 400) {
    return new VexError(
      ErrorCodes.VIRTUALS_API_ERROR,
      "Virtuals API rejected the request (HTTP 400).",
      "The list endpoint requires a chain filter — call listVirtuals with a chain.",
    );
  }

  if (status >= 500) {
    const err = new VexError(
      ErrorCodes.VIRTUALS_API_ERROR,
      `Virtuals server error (HTTP ${status}).`,
      "Virtuals server error. Try again later.",
    );
    err.retryable = true;
    return err;
  }

  return new VexError(ErrorCodes.VIRTUALS_API_ERROR, `Virtuals API returned HTTP ${status}.`);
}

export function mapVirtualsTransportError(err: unknown): never {
  if (err instanceof VexError && err.code.startsWith("VIRTUALS_")) {
    throw err;
  }
  if (err instanceof VexError && err.code === ErrorCodes.HTTP_TIMEOUT) {
    throw new VexError(ErrorCodes.VIRTUALS_TIMEOUT, err.message, err.hint);
  }
  if (err instanceof VexError && err.code === ErrorCodes.HTTP_REQUEST_FAILED) {
    throw new VexError(ErrorCodes.VIRTUALS_API_ERROR, err.message, err.hint);
  }
  throw err;
}
