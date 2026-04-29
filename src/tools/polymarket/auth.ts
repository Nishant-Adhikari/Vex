/**
 * Polymarket CLOB API authentication.
 *
 * HMAC-SHA256 request signing using node:crypto (zero external dependencies).
 * Also handles programmatic API key derivation (L1 wallet sign → derive creds).
 */

import { createHmac } from "node:crypto";
import { VexError, ErrorCodes } from "../../errors.js";
import {
  ENV_POLYMARKET_API_KEY,
  ENV_POLYMARKET_API_SECRET,
  ENV_POLYMARKET_PASSPHRASE,
} from "./constants.js";

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

// ── Credential loading from env ─────────────────────────────────────

export interface PolyClobCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

/**
 * Load Polymarket CLOB credentials from environment.
 * Throws POLYMARKET_NOT_CONFIGURED if any are missing.
 */
export function requirePolyClobCredentials(): PolyClobCredentials {
  const apiKey = process.env[ENV_POLYMARKET_API_KEY];
  const apiSecret = process.env[ENV_POLYMARKET_API_SECRET];
  const passphrase = process.env[ENV_POLYMARKET_PASSPHRASE];

  if (!apiKey || !apiSecret || !passphrase) {
    throw new VexError(
      ErrorCodes.POLYMARKET_NOT_CONFIGURED,
      "Polymarket CLOB API key not configured",
      "Run 'vex polymarket setup --yes' to auto-generate API credentials.",
    );
  }

  return { apiKey, apiSecret, passphrase };
}

/**
 * Check if Polymarket credentials are configured (non-throwing).
 */
export function hasPolyClobCredentials(): boolean {
  return !!(
    process.env[ENV_POLYMARKET_API_KEY] &&
    process.env[ENV_POLYMARKET_API_SECRET] &&
    process.env[ENV_POLYMARKET_PASSPHRASE]
  );
}
