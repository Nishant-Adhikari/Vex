/**
 * Polymarket CLOB API credential derivation — canonical source of truth.
 *
 * Flow: wallet keystore → nonce → sign → derive-api-key → save to .env
 * Used by: echo-agent internal tool + CLI `echoclaw polymarket setup`
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
  ENV_POLYMARKET_API_KEY,
  ENV_POLYMARKET_API_SECRET,
  ENV_POLYMARKET_PASSPHRASE,
} from "./constants.js";

export interface DeriveResult {
  /** First 8 characters of API key — safe for display/output. */
  apiKeyPrefix: string;
  /** Path to .env file where credentials were saved. */
  envFilePath: string;
  /** Wallet address used for derivation. */
  address: string;
}

/**
 * Derive Polymarket CLOB API credentials from wallet keystore and save to .env.
 *
 * 1. Get wallet from keystore
 * 2. Fetch nonce from Polymarket
 * 3. Sign nonce with wallet private key
 * 4. POST to derive-api-key endpoint
 * 5. Save apiKey/secret/passphrase to .env via writeAppEnvValue
 * 6. Set process.env immediately for same-process use
 *
 * Throws EchoError on failure (network, auth, missing fields).
 */
export async function deriveAndSavePolymarketCredentials(): Promise<DeriveResult> {
  const { address, privateKey } = requireWalletAndKeystore();

  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { polygon } = await import("viem/chains");

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  createWalletClient({ account, chain: polygon, transport: http() });

  // Step 1: Get nonce
  const nonceResponse = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/nonce`, {
    method: "GET",
    timeoutMs: 15000,
  });

  let nonce = "0";
  if (nonceResponse.ok) {
    const nonceData = await readJson(nonceResponse);
    if (typeof nonceData === "string") nonce = nonceData;
    else if (isRecord(nonceData) && typeof nonceData.nonce === "string") nonce = nonceData.nonce;
  }

  // Step 2: Sign nonce
  const signature = await account.signMessage({ message: nonce });

  // Step 3: Derive API key
  const deriveResponse = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/derive-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: account.address,
      nonce,
      signature,
      timestamp: Math.floor(Date.now() / 1000).toString(),
    }),
    timeoutMs: 15000,
  });

  if (!deriveResponse.ok) {
    const errBody = await readJson(deriveResponse);
    const errMsg = isRecord(errBody) && typeof errBody.error === "string"
      ? errBody.error : `HTTP ${deriveResponse.status}`;
    throw new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, `Failed to derive API key: ${errMsg}`);
  }

  const creds = await readJson(deriveResponse);
  if (!isRecord(creds) || !creds.apiKey || !creds.secret || !creds.passphrase) {
    throw new EchoError(ErrorCodes.POLYMARKET_AUTH_FAILED, "Invalid API key response from Polymarket");
  }

  // Step 4: Save to .env
  const envFilePath = writeAppEnvValue(ENV_POLYMARKET_API_KEY, String(creds.apiKey));
  writeAppEnvValue(ENV_POLYMARKET_API_SECRET, String(creds.secret));
  writeAppEnvValue(ENV_POLYMARKET_PASSPHRASE, String(creds.passphrase));

  // Set in process.env for immediate use
  process.env[ENV_POLYMARKET_API_KEY] = String(creds.apiKey);
  process.env[ENV_POLYMARKET_API_SECRET] = String(creds.secret);
  process.env[ENV_POLYMARKET_PASSPHRASE] = String(creds.passphrase);

  return {
    apiKeyPrefix: String(creds.apiKey).slice(0, 8),
    envFilePath,
    address: account.address,
  };
}
