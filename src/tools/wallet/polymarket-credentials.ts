/**
 * Polymarket CLOB API credential derivation — canonical source of truth.
 *
 * Moved out of `src/tools/polymarket/` in puzzle 5 phase 5D-protocols p5 (Codex
 * ruling): this is credential SETUP (sign an EIP-712 ClobAuth with the wallet
 * keystore → derive/create API creds → persist), NOT session-scoped protocol
 * trading. It legitimately decrypts the keystore, so it lives in a wallet
 * module — keeping protocol paths free of keystore/decrypt imports (the
 * keystore-isolation scan stays strict-empty for protocol code).
 *
 * Puzzle 5 B-core: derivation is now PER-WALLET. `deriveAndSave…({ walletId })`
 * targets a specific session EVM wallet and merges its creds into the
 * `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` map (see `polymarket/credential-map.ts`);
 * omitting `walletId` keeps the primary-wallet behavior. The read side lives in
 * `polymarket/auth.requirePolyClobCredentials(address)`.
 *
 * Flow: wallet keystore → EIP-712 ClobAuth signature → derive/create API key → save to encrypted vault
 * Used by:
 *   - vex-agent internal tool (legacy env-driven path)
 *   - vex-app onboarding handler (env-free `acquire...` primitive)
 *
 * Two-tier surface per Codex Phase-2 review:
 *   1. `acquirePolymarketCredentialsWithPassword(password)` — env-free primitive.
 *      Decrypts the keystore using the explicitly provided password, signs the
 *      L1 EIP-712 ClobAuth, calls Polymarket. Returns credentials in memory.
 *      Does NOT touch the vault, .env, or process.env.
 *   2. `deriveAndSavePolymarketCredentials({ secretsFilePath? })` — legacy
 *      wrapper. Resolves the master password from process.env
 *      (`VEX_KEYSTORE_PASSWORD`), then composes the acquire primitive with the
 *      same vault-persist + .env-strip + same-process env-apply as before.
 *
 * Auth: L1 EIP-712 typed data signature in request headers (POLY_ADDRESS,
 * POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE). NOT JSON body auth.
 *
 * No secrets in return value — only apiKeyPrefix (first 8 chars + ellipsis).
 *
 * Compatibility façade: the implementation now lives in
 * `./polymarket-credentials/`. This file re-exports the IDENTICAL public surface
 * so existing callers (src/lib/polymarket.ts via @vex-lib, polymarket/credential-map,
 * vex-agent polymarket-setup) see no difference.
 */

export { acquirePolymarketCredentialsWithPassword } from "./polymarket-credentials/acquire.js";
export type { AcquireResult } from "./polymarket-credentials/acquire.js";
export type { AcquiredPolymarketCredentials } from "./polymarket-credentials/parse.js";
export {
  deriveAndSavePolymarketCredentials,
} from "./polymarket-credentials/derive.js";
export type { DeriveResult } from "./polymarket-credentials/derive.js";
