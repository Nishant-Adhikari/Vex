/**
 * Polymarket CLOB credential derive-and-save — legacy env-driven entry point.
 *
 * Split out of `wallet/polymarket-credentials.ts` (façade-preserving structural
 * split): composes the env-free `acquirePolymarketCredentialsWithPassword`
 * primitive with vault persistence. Resolves the master password from
 * process.env, merges creds into the per-wallet credential map via
 * `buildPolymarketVaultUpdates`, writes the vault, strips the legacy .env, and
 * mirrors the written keys into this process.
 *
 * No secrets in return value — only apiKeyPrefix (first 8 chars + ellipsis).
 */

import { type Address, getAddress } from "viem";
import { loadConfig } from "../../../config/store.js";
import {
  getPrimaryEvmAddress,
  getPrimaryEvmEntry,
  getWalletById,
} from "../inventory.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import {
  stripManagedSecretsFromDotenvFile,
  writeSecretVaultSecrets,
} from "../../../lib/local-secret-vault.js";
import { requireKeystorePassword } from "../../../utils/env.js";
import { ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS } from "../../polymarket/constants.js";
import {
  type StoredPolyCredentials,
  buildPolymarketVaultUpdates,
} from "../../polymarket/credential-map.js";
import { acquirePolymarketCredentialsWithPassword } from "./acquire.js";

export interface DeriveResult {
  /** First 8 characters of API key + ellipsis — safe for display/output. */
  apiKeyPrefix: string;
  /** Storage location where credentials were saved. */
  storage: "secret-vault";
  /** Wallet address used for derivation. */
  address: Address;
}

/**
 * Derive Polymarket CLOB API credentials for an EVM wallet and save them into
 * the per-wallet credential map. Legacy env-driven entry point used by the
 * vex-agent internal tool (`polymarket_setup`).
 *
 * Target wallet:
 *   - `options.walletId` → that specific session EVM wallet;
 *   - omitted → the primary EVM wallet (legacy behavior).
 *
 * Persistence (puzzle 5 B-core): the creds are MERGED into the
 * `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` map (keyed by normalized address),
 * preserving every other wallet's entry. For the PRIMARY wallet only, the three
 * fixed keys are also written — backward compat for the legacy read fallback and
 * the `polymarket_setup` visibility gate. Legacy keys are never deleted here.
 *
 * Resolves the master password from `process.env.VEX_KEYSTORE_PASSWORD` via
 * `requireKeystorePassword()`. The Electron app does NOT use this path — it
 * calls `acquirePolymarketCredentialsWithPassword` directly with the unlocked
 * in-memory password.
 *
 * Throws `VexError` on failure (no wallet, network, auth, missing fields).
 */
export async function deriveAndSavePolymarketCredentials(
  options: { readonly walletId?: string; readonly secretsFilePath?: string } = {},
): Promise<DeriveResult> {
  const cfg = loadConfig();

  // Resolve the target EVM wallet: an explicit session wallet by id, else the
  // primary (legacy behavior).
  const entry = options.walletId
    ? getWalletById("evm", options.walletId, cfg)
    : getPrimaryEvmEntry(cfg);
  if (!entry) {
    throw new VexError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      options.walletId ? "Selected EVM wallet not found." : "No wallet configured.",
      options.walletId
        ? "Re-select an EVM wallet for this session."
        : "Run: vex wallet create --json",
    );
  }

  const masterPassword = requireKeystorePassword();
  const { address, credentials } = await acquirePolymarketCredentialsWithPassword(
    masterPassword,
    entry,
  );

  const stored: StoredPolyCredentials = {
    apiKey: credentials.apiKey,
    apiSecret: credentials.secret,
    passphrase: credentials.passphrase,
  };

  // Primary wallet → the updates ALSO refresh the three fixed keys (legacy read
  // fallback + setup-tool visibility). Non-primary wallets live in the map only.
  const primaryAddress = getPrimaryEvmAddress(cfg);
  const isPrimary =
    primaryAddress !== null && getAddress(primaryAddress) === getAddress(address);

  // Single source of truth for which vault keys to write (shared with the
  // vex-app onboarding handler) — map merge + primary-only fixed keys.
  const updates = buildPolymarketVaultUpdates({
    currentMapEnv: process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS],
    address,
    creds: stored,
    isPrimary,
  });

  // Persistence — vault write + .env strip + same-process env apply.
  writeSecretVaultSecrets(
    masterPassword,
    updates,
    options.secretsFilePath ? { filePath: options.secretsFilePath } : {},
  );
  stripManagedSecretsFromDotenvFile();

  // Mirror the written keys into this process so the new creds are usable now.
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) process.env[key] = value;
  }

  return {
    apiKeyPrefix: `${credentials.apiKey.slice(0, 8)}…`,
    storage: "secret-vault",
    address,
  };
}
