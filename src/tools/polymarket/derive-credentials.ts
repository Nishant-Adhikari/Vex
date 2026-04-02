/**
 * Polymarket CLOB API credential derivation — canonical source of truth.
 *
 * Flow: wallet keystore → EIP-712 ClobAuth signature → derive/create API key → save to .env
 * Used by: echo-agent internal tool + CLI `echoclaw polymarket setup`
 *
 * Auth: L1 EIP-712 typed data signature in request headers (POLY_ADDRESS, POLY_SIGNATURE,
 * POLY_TIMESTAMP, POLY_NONCE). NOT JSON body auth.
 *
 * No secrets in return value — only apiKeyPrefix (first 8 chars).
 */

import { requireWalletAndKeystore } from "../wallet/auth.js";
import { fetchWithTimeout, readJson } from "../../utils/http.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import { isRecord } from "../../utils/validation-helpers.js";
import {
  CLOB_BASE_URL,
  CLOB_TIMEOUT_MS,
  POLYGON_CHAIN_ID,
  ENV_POLYMARKET_API_KEY,
  ENV_POLYMARKET_API_SECRET,
  ENV_POLYMARKET_PASSPHRASE,
} from "./constants.js";

// ── EIP-712 ClobAuth domain + types (from Polymarket docs) ─────────

const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
} as const;

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

const CLOB_AUTH_MESSAGE = "This message attests that I control the given wallet";

export interface DeriveResult {
  /** First 8 characters of API key — safe for display/output. */
  apiKeyPrefix: string;
  /** Path to .env file where credentials were saved. */
  envFilePath: string;
  /** Wallet address used for derivation. */
  address: string;
}

/**
 * Build L1 auth headers for Polymarket CLOB API.
 * Signs EIP-712 ClobAuth typed data with wallet private key.
 */
async function buildL1AuthHeaders(
  privateKey: `0x${string}`,
  nonce = 0,
): Promise<{ headers: Record<string, string>; address: string }> {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { polygon } = await import("viem/chains");

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain: polygon, transport: http() });

  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signature = await client.signTypedData({
    domain: CLOB_AUTH_DOMAIN,
    types: CLOB_AUTH_TYPES,
    primaryType: "ClobAuth",
    message: {
      address: account.address,
      timestamp,
      nonce: BigInt(nonce),
      message: CLOB_AUTH_MESSAGE,
    },
  });

  return {
    headers: {
      POLY_ADDRESS: account.address,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_NONCE: String(nonce),
    },
    address: account.address,
  };
}

/**
 * Derive Polymarket CLOB API credentials from wallet keystore and save to .env.
 *
 * 1. Get wallet from keystore
 * 2. Sign EIP-712 ClobAuth typed data
 * 3. Try GET /auth/derive-api-key (recover existing creds)
 * 4. If not found, POST /auth/api-key (create new creds)
 * 5. Save apiKey/secret/passphrase to .env via writeAppEnvValue
 * 6. Set process.env immediately for same-process use
 *
 * Throws EchoError on failure (network, auth, missing fields).
 */
export async function deriveAndSavePolymarketCredentials(): Promise<DeriveResult> {
  const { privateKey } = requireWalletAndKeystore();
  const hexKey = privateKey as `0x${string}`;

  // Build L1 auth headers with EIP-712 signature
  const { headers, address } = await buildL1AuthHeaders(hexKey);

  // Try derive first (GET — recovers existing credentials)
  let creds = await tryDeriveApiKey(headers);

  // Fall back to create (POST — generates new credentials)
  if (!creds) {
    creds = await createApiKey(headers);
  }

  if (!creds) {
    throw new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, "Failed to derive or create API key");
  }

  // Save to .env
  const envFilePath = writeAppEnvValue(ENV_POLYMARKET_API_KEY, creds.apiKey);
  writeAppEnvValue(ENV_POLYMARKET_API_SECRET, creds.secret);
  writeAppEnvValue(ENV_POLYMARKET_PASSPHRASE, creds.passphrase);

  // Set in process.env for immediate use
  process.env[ENV_POLYMARKET_API_KEY] = creds.apiKey;
  process.env[ENV_POLYMARKET_API_SECRET] = creds.secret;
  process.env[ENV_POLYMARKET_PASSPHRASE] = creds.passphrase;

  return {
    apiKeyPrefix: creds.apiKey.slice(0, 8),
    envFilePath,
    address,
  };
}

// ── Internal helpers ────────────────────────────────────────────────

interface ApiCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

async function tryDeriveApiKey(l1Headers: Record<string, string>): Promise<ApiCredentials | null> {
  try {
    const response = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/derive-api-key`, {
      method: "GET",
      headers: l1Headers,
      timeoutMs: CLOB_TIMEOUT_MS,
    });

    if (!response.ok) return null;

    const data = await readJson(response);
    return parseCredentials(data);
  } catch {
    return null;
  }
}

async function createApiKey(l1Headers: Record<string, string>): Promise<ApiCredentials | null> {
  const response = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/api-key`, {
    method: "POST",
    headers: l1Headers,
    timeoutMs: CLOB_TIMEOUT_MS,
  });

  if (!response.ok) {
    const errBody = await readJson(response).catch(() => null);
    const errMsg = isRecord(errBody) && typeof errBody.error === "string"
      ? errBody.error : `HTTP ${response.status}`;
    throw new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, `Failed to create API key: ${errMsg}`);
  }

  const data = await readJson(response);
  return parseCredentials(data);
}

function parseCredentials(data: unknown): ApiCredentials | null {
  if (!isRecord(data)) return null;
  const apiKey = typeof data.apiKey === "string" ? data.apiKey : null;
  const secret = typeof data.secret === "string" ? data.secret : null;
  const passphrase = typeof data.passphrase === "string" ? data.passphrase : null;
  if (!apiKey || !secret || !passphrase) return null;
  return { apiKey, secret, passphrase };
}
