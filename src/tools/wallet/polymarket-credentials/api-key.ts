/**
 * Polymarket CLOB api-key flows — derive (recover) + create.
 *
 * Split out of `wallet/polymarket-credentials.ts` (façade-preserving structural
 * split): `tryDeriveApiKey` is best-effort recovery via GET /auth/derive-api-key
 * and `createApiKey` generates new credentials via POST /auth/api-key with the
 * canonical 4xx-vs-5xx/network error mapping. Both consume the single-sourced
 * `parseCredentials`.
 *
 * No secrets are logged here — credentials only flow back to the caller
 * in-memory.
 */

import { fetchWithTimeout, readJson } from "../../../utils/http.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { CLOB_BASE_URL, CLOB_TIMEOUT_MS } from "../../polymarket/constants.js";
import { type AcquiredPolymarketCredentials, parseCredentials } from "./parse.js";

export async function tryDeriveApiKey(
  l1Headers: Record<string, string>,
): Promise<AcquiredPolymarketCredentials | null> {
  // Derive path is "best effort recovery"; any non-2xx or parse failure
  // simply falls through to create. We deliberately do NOT bubble HTTP
  // errors here — the create call below provides the canonical error
  // surface (4xx vs 5xx) for the handler.
  let response: Response;
  try {
    response = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/derive-api-key`, {
      method: "GET",
      headers: l1Headers,
      timeoutMs: CLOB_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  const data = await readJson(response);
  return parseCredentials(data);
}

export async function createApiKey(
  l1Headers: Record<string, string>,
): Promise<AcquiredPolymarketCredentials> {
  // Network / timeout / DNS / connection-refused → HTTP_REQUEST_FAILED.
  // `fetchWithTimeout` already wraps these into a VexError(HTTP_REQUEST_FAILED
  // | HTTP_TIMEOUT). We re-throw both as `HTTP_REQUEST_FAILED` so the
  // handler surfaces a single transient-error code.
  let response: Response;
  try {
    response = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/api-key`, {
      method: "POST",
      headers: l1Headers,
      timeoutMs: CLOB_TIMEOUT_MS,
    });
  } catch (cause: unknown) {
    if (cause instanceof VexError && cause.code === ErrorCodes.HTTP_TIMEOUT) {
      // Surface timeout as a network error — same retry semantics for the UI.
      throw new VexError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        cause.message,
        cause.hint,
      );
    }
    throw cause;
  }

  // 4xx → auth failure (signature rejected, address blocked, etc.). The
  // handler maps to `provider.polymarket_setup_failed`.
  // 5xx → server-side transient failure. Maps to `provider.unavailable`.
  if (!response.ok) {
    const errBody = await readJson(response).catch(() => null);
    const errMsg = isRecord(errBody) && typeof errBody.error === "string"
      ? errBody.error
      : `HTTP ${response.status}`;

    if (response.status >= 500) {
      throw new VexError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        `Polymarket API unavailable: ${errMsg}`,
        "Try again in a moment.",
      );
    }
    throw new VexError(
      ErrorCodes.POLYMARKET_AUTH_FAILED,
      `Failed to create API key: ${errMsg}`,
    );
  }

  const data = await readJson(response);
  const parsed = parseCredentials(data);
  if (!parsed) {
    // 200 with malformed body — treat as an auth-layer failure (the API
    // contract was violated) rather than a network error.
    throw new VexError(
      ErrorCodes.POLYMARKET_AUTH_FAILED,
      "Polymarket API returned an unexpected response.",
    );
  }
  return parsed;
}
