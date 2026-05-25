/**
 * Polymarket CLOB API authentication.
 *
 * HMAC-SHA256 request signing using node:crypto (zero external dependencies).
 * Also handles programmatic API key derivation (L1 wallet sign → derive creds).
 */

import { createHmac } from "node:crypto";
import { VexError, ErrorCodes } from "../../errors.js";
import { getPrimaryEvmAddress } from "../wallet/inventory.js";
import {
  ENV_POLYMARKET_API_KEY,
  ENV_POLYMARKET_API_SECRET,
  ENV_POLYMARKET_PASSPHRASE,
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
} from "./constants.js";
import {
  type StoredPolyCredentials,
  normalizePolyAddress,
  parseCredentialMapEnv,
} from "./credential-map.js";

// ── HMAC-SHA256 request signing ─────────────────────────────────────

/**
 * Sign a CLOB API request with HMAC-SHA256.
 *
 * @param method - HTTP method (GET, POST, DELETE)
 * @param path - Request path (e.g., /order)
 * @param body - Request body string (empty string for GET/DELETE without body)
 * @param apiSecret - CLOB API secret
 * @returns { timestamp, signature }
 */
export function signClobRequest(
  method: string,
  path: string,
  body: string,
  apiSecret: string,
): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method.toUpperCase() + path + body;
  const signature = createHmac("sha256", apiSecret)
    .update(message)
    .digest("base64");
  return { timestamp, signature };
}

/**
 * Build all required CLOB auth headers.
 *
 * Headers: POLY_API_KEY, POLY_ADDRESS, POLY_SIGNATURE, POLY_PASSPHRASE, POLY_TIMESTAMP
 */
export function buildClobHeaders(
  apiKey: string,
  address: string,
  passphrase: string,
  method: string,
  path: string,
  body: string,
  apiSecret: string,
): Record<string, string> {
  const { timestamp, signature } = signClobRequest(method, path, body, apiSecret);
  return {
    POLY_API_KEY: apiKey,
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_PASSPHRASE: passphrase,
    POLY_TIMESTAMP: timestamp,
  };
}

// ── Per-wallet credential loading (puzzle 5 B-core) ─────────────────

/** One wallet's CLOB credentials. Canonical shape owned by `credential-map.ts`. */
export type PolyClobCredentials = StoredPolyCredentials;

/** Mask an address for error messages (no secret, but avoids full-address noise). */
function maskAddress(address: string): string {
  return address.length >= 10
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/** Read the three fixed legacy env keys, or null when any is missing. */
function readLegacyFixedCredentials(): PolyClobCredentials | null {
  const apiKey = process.env[ENV_POLYMARKET_API_KEY];
  const apiSecret = process.env[ENV_POLYMARKET_API_SECRET];
  const passphrase = process.env[ENV_POLYMARKET_PASSPHRASE];
  if (!apiKey || !apiSecret || !passphrase) return null;
  return { apiKey, apiSecret, passphrase };
}

/**
 * Load the CLOB credentials for a SPECIFIC wallet address.
 *
 * Resolution order:
 *   1. Per-wallet map entry (`POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`), keyed by
 *      the normalized address — the owner==signer credentials.
 *   2. Legacy fallback, PRIMARY WALLET ONLY: no map entry AND `address` is the
 *      current primary EVM address AND the three fixed env keys exist → return
 *      those (pre-B setups). Never used for a non-primary wallet — that would
 *      post an order whose `owner` (apiKey) mismatches the `signer`, which
 *      Polymarket rejects.
 *
 * A present-but-malformed map throws (fail closed — see `parseCredentialMapEnv`).
 * Throws POLYMARKET_NOT_CONFIGURED when nothing resolves for `address`.
 */
export function requirePolyClobCredentials(address: string): PolyClobCredentials {
  const normalized = normalizePolyAddress(address);

  const map = parseCredentialMapEnv(
    process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS],
  );
  const entry = map[normalized];
  if (entry) return entry;

  const primary = getPrimaryEvmAddress();
  if (primary && normalizePolyAddress(primary) === normalized) {
    const legacy = readLegacyFixedCredentials();
    if (legacy) return legacy;
  }

  throw new VexError(
    ErrorCodes.POLYMARKET_NOT_CONFIGURED,
    `Polymarket CLOB API credentials not configured for wallet ${maskAddress(normalized)}.`,
    "Run polymarket_setup for the wallet selected in this session to derive API credentials.",
  );
}

/**
 * Check if CLOB credentials are configured for `address` (non-throwing).
 * Returns false on any resolution failure, including a malformed map — the
 * throwing `requirePolyClobCredentials` is the surface that exposes corruption.
 */
export function hasPolyClobCredentials(address: string): boolean {
  try {
    requirePolyClobCredentials(address);
    return true;
  } catch {
    return false;
  }
}
