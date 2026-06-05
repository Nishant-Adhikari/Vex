/**
 * Polymarket CLOB L1 auth — EIP-712 ClobAuth domain/types + header signing.
 *
 * Split out of `wallet/polymarket-credentials.ts` (façade-preserving structural
 * split): this module owns the EIP-712 ClobAuth typed-data definitions and the
 * `buildL1AuthHeaders` signer that turns a decrypted private key into the
 * POLY_* request headers.
 *
 * Auth: L1 EIP-712 typed data signature in request headers (POLY_ADDRESS,
 * POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE). NOT JSON body auth.
 */

import { type Address, type Hex } from "viem";
import { POLYGON_CHAIN_ID } from "../../polymarket/constants.js";

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

/**
 * Build L1 auth headers for Polymarket CLOB API.
 * Signs EIP-712 ClobAuth typed data with wallet private key.
 */
export async function buildL1AuthHeaders(
  privateKey: Hex,
  nonce = 0,
): Promise<{ headers: Record<string, string>; address: Address }> {
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
