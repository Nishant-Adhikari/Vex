/**
 * Polymarket CLOB credential response parsing — single source of truth.
 *
 * Split out of `wallet/polymarket-credentials.ts` (façade-preserving structural
 * split): `parseCredentials` normalizes the raw `/auth/derive-api-key` and
 * `/auth/api-key` response bodies into the in-memory credential trio. Shared by
 * the api-key flows and (transitively) the acquire/derive composition — kept in
 * exactly one module so the validation rule cannot drift.
 *
 * No secrets are logged here: the parsed credentials are only returned in-memory
 * to the caller.
 */

import { isRecord } from "../../../utils/validation-helpers.js";

export interface AcquiredPolymarketCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export function parseCredentials(data: unknown): AcquiredPolymarketCredentials | null {
  if (!isRecord(data)) return null;
  const apiKey = typeof data.apiKey === "string" ? data.apiKey : null;
  const secret = typeof data.secret === "string" ? data.secret : null;
  const passphrase = typeof data.passphrase === "string" ? data.passphrase : null;
  if (!apiKey || !secret || !passphrase) return null;
  return { apiKey, secret, passphrase };
}
