/**
 * Polymarket CLOB credential acquire primitive — env-free.
 *
 * Split out of `wallet/polymarket-credentials.ts` (façade-preserving structural
 * split): decrypts the wallet keystore with the explicitly provided password,
 * asserts the selected-wallet address (per-wallet B-core), scrubs the local
 * private-key binding, signs the L1 EIP-712 ClobAuth (`buildL1AuthHeaders`), and
 * runs the derive → create api-key sequence. Returns credentials in-memory and
 * never touches the vault, .env, or process.env.
 *
 * No secrets are logged here — the decrypted key is scrubbed after signing and
 * credentials are returned in-memory only.
 */

import { type Address, type Hex, getAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { loadKeystore, loadKeystoreFile, decryptPrivateKey } from "../keystore.js";
import { type WalletInventoryEntry } from "../../../config/store.js";
import { derivePath } from "../inventory.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { type AcquiredPolymarketCredentials } from "./parse.js";
import { buildL1AuthHeaders } from "./auth.js";
import { tryDeriveApiKey, createApiKey } from "./api-key.js";

export interface AcquireResult {
  address: Address;
  credentials: AcquiredPolymarketCredentials;
}

/**
 * Acquire (derive or create) Polymarket CLOB API credentials for the EVM
 * wallet stored on disk. Decrypts the wallet keystore using the explicitly
 * provided password (NO process.env dependency). Signs the L1 EIP-712
 * ClobAuth, calls Polymarket /auth/derive-api-key (with 15s timeout), and
 * falls back to /auth/api-key creation if derive returns nothing.
 *
 * Returns the credentials in memory — caller is responsible for persisting
 * them under a write lock and dropping the reference. This function does
 * NOT touch the secret vault, .env, or process.env.
 *
 * Throws engine `VexError` codes:
 *   - `KEYSTORE_NOT_FOUND`    wallet keystore missing
 *   - `KEYSTORE_DECRYPT_FAILED` keystore decrypt failed (wrong password or
 *                              corrupt ciphertext) — distinct from a
 *                              `LocalSecretVaultError("invalid_password")`
 *                              raised by the master-password vault layer.
 *                              The handler decides which surface to map to.
 *   - `POLYMARKET_AUTH_FAILED` API rejection or malformed response (4xx)
 *   - `HTTP_REQUEST_FAILED`    network / timeout / 5xx
 */
export async function acquirePolymarketCredentialsWithPassword(
  password: string,
  entry?: WalletInventoryEntry,
): Promise<AcquireResult> {
  // 1. Keystore must exist on disk. For a specific session wallet (`entry`),
  // resolve its derived keystore path (traversal-guarded by `derivePath`);
  // otherwise the primary (legacy) keystore.
  const keystore = entry ? loadKeystoreFile(derivePath("evm", entry)) : loadKeystore();
  if (!keystore) {
    throw new VexError(
      ErrorCodes.KEYSTORE_NOT_FOUND,
      entry ? "Keystore not found for the selected EVM wallet." : "Keystore not found.",
      "Generate or import an EVM wallet before configuring Polymarket.",
    );
  }

  // 2. Decrypt with the EXPLICIT password — engine raises
  // `KEYSTORE_DECRYPT_FAILED` on wrong password or corrupt ciphertext.
  // Propagate untouched so the handler can map it to `wallet.password_invalid`.
  // `let` (not `const`) so we can overwrite the binding after the signer
  // consumes the key. JS strings are immutable, so this only drops OUR
  // reference; any internal copy in viem's account survives until GC, but
  // shortening the lifetime of the local binding is the strongest in-process
  // defense available.
  let privateKey: Hex = decryptPrivateKey(keystore, password);

  // 2b. Per-wallet derive (B-core): assert the decrypted key derives the
  // recorded address BEFORE signing, so creds are never derived/bound with a
  // key that isn't the selected wallet (Codex B-core ruling — fail closed).
  // Scrub the local binding before throwing.
  if (entry && privateKeyToAddress(privateKey) !== getAddress(entry.address)) {
    privateKey = "0x" as Hex;
    throw new VexError(
      ErrorCodes.SIGNER_MISMATCH,
      "EVM keystore does not match the selected wallet address.",
      "Re-import the wallet or restore from backup.",
    );
  }

  // 3. Sign EIP-712 ClobAuth. `try/finally` guarantees the local binding is
  // overwritten whether the signer succeeds or throws — so any subsequent
  // network call below executes with `privateKey` already scrubbed.
  let headers: Record<string, string>;
  let address: Address;
  try {
    const built = await buildL1AuthHeaders(privateKey);
    headers = built.headers;
    address = built.address;
  } finally {
    privateKey = "0x" as Hex;
  }

  // 4. Try derive first (GET — recovers existing credentials).
  const derived = await tryDeriveApiKey(headers);
  if (derived) return { address, credentials: derived };

  // 5. Fall back to create (POST — generates new credentials). 4xx vs
  // 5xx/network is distinguished so the handler can surface a
  // user-actionable auth error separately from a transient network error.
  const created = await createApiKey(headers);
  return { address, credentials: created };
}
