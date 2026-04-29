/**
 * Slop App error mapping — HTTP status → typed VexError.
 */

import { VexError, ErrorCodes } from "../../errors.js";

export function mapSlopAppError(status: number, message: string): VexError {
  if (status === 400) {
    return new VexError(ErrorCodes.AGENT_QUERY_INVALID, message);
  }
  if (status === 401) {
    return new VexError(ErrorCodes.SLOP_AUTH_FAILED, message);
  }
  if (status === 403) {
    return new VexError(
      ErrorCodes.PROFILE_NOT_FOUND,
      message || "Profile required",
      "Register profile first: vex slop-app profile register --username <name> --yes --json",
    );
  }
  if (status === 429) {
    const error = new VexError(ErrorCodes.AGENT_QUERY_FAILED, "Rate limited, try again later");
    error.retryable = true;
    return error;
  }
  if (status === 504) {
    return new VexError(ErrorCodes.AGENT_QUERY_TIMEOUT, "Query too complex, simplify filters");
  }
  return new VexError(ErrorCodes.AGENT_QUERY_FAILED, message || `Slop App API error (HTTP ${status})`);
}

export function mapSlopAppTransportError(err: unknown): never {
  if (err instanceof VexError) throw err;
  throw new VexError(
    ErrorCodes.HTTP_REQUEST_FAILED,
    `Slop App request failed: ${err instanceof Error ? err.message : String(err)}`,
  );
}
