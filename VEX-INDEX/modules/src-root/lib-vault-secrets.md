---
id: module.src-root.lib-vault-secrets
kind: module
paths:
  - "src/lib/local-secret-vault.ts"
  - "src/lib/secret-keys.ts"
  - "src/lib/polymarket.ts"
  - "src/tools/polymarket/credential-map.ts"
  - "src/tools/wallet/polymarket-credentials.ts"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/lib/local-secret-vault.ts"
  - "src/lib/secret-keys.ts"
  - "src/lib/polymarket.ts"
  - "src/tools/polymarket/credential-map.ts"
  - "src/tools/wallet/polymarket-credentials.ts"
  - "src/tools/polymarket/constants.ts"
  - "src/config/paths.ts"
  - "src/utils/dotenv.ts"
  - "vex-app/src/main/secrets/session.ts"
  - "vex-app/src/main/ipc/onboarding/polymarket-setup.ts"
  - "vex-app/src/main/ipc/wallet-export.ts"
related:
  - module.src-root.lib-wallet
  - module.src-root.lib-env-config
  - module.vex-agent.inference
  - ADR-0001-global-model-session-wallet
---

# src-root / lib-vault-secrets

## Purpose

Encrypted local secret vault (AES-256-GCM + scrypt KDF) plus the
Polymarket per-wallet CLOB credential subsystem. This module is the single
source of truth for what secrets exist, how they are stored on disk, how
they are injected into `process.env` on unlock, how managed secrets are
stripped from the plaintext `.env` file, and how Polymarket CLOB API
credentials are derived (EIP-712 ClobAuth), persisted (per-wallet map
inside the vault), and read back (map parse + legacy primary fallback).

The vault is the ONLY persistent store for `OPENROUTER_API_KEY`,
`JUPITER_API_KEY`, `TAVILY_API_KEY`, `RETTIWT_API_KEY`,
`POLYMARKET_API_KEY/SECRET/PASSPHRASE`, and the per-wallet
`POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` JSON map. None of these ever
appear in the plaintext `.env`; `stripManagedSecretsFromDotenvFile`
enforces that invariant after every write.

## Retrieval keywords

- vault, secret vault, local-secret-vault, AES-256-GCM, scrypt, KDF, master password
- unlock, lock, applySecretVaultToProcessEnv, unlockSecretVault, createSecretVault
- writeSecretVaultSecrets, verifySecretVaultPassword, KDF upgrade
- VAULT_SECRET_KEYS, MASTER_PASSWORD_ENV_KEY, VEX_KEYSTORE_PASSWORD, isManagedSecretEnvKey
- stripManagedSecretsFromDotenvFile, managed secret, .env strip, env injection
- Polymarket CLOB credentials, EIP-712, ClobAuth, derive-api-key, per-wallet credentials
- POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS, credential-map, parseCredentialMapEnv
- buildPolymarketVaultUpdates, acquirePolymarketCredentialsWithPassword
- deriveAndSavePolymarketCredentials, StoredPolyCredentials

## State owned

### On-disk

- `secrets.vault.json` (`${CONFIG_DIR}/secrets.vault.json`): encrypted vault file.
  Schema (Zod-validated, field `version:1`): `{ version, kdf, salt, iv, tag, ciphertext }`.
  All fields base64-encoded. `kdf` block carries the exact params used for that file so
  older files remain decryptable after a KDF parameter upgrade.

### In `process.env` (after unlock)

All keys below are absent before a successful unlock and are injected into
`process.env` by the unlock flow. `lockSecretSession()` currently clears the
in-memory master password only; it does **not** remove these vault-injected keys
from `process.env`. They are never loaded from the plaintext `.env` — vault is
the sole source.

| Key | Role |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter LLM access (injected for inference layer) |
| `JUPITER_API_KEY` | Solana Jupiter DEX aggregator |
| `TAVILY_API_KEY` | Web search integration |
| `RETTIWT_API_KEY` | Twitter/X API integration |
| `POLYMARKET_API_KEY` | Legacy primary-wallet CLOB API key |
| `POLYMARKET_API_SECRET` | Legacy primary-wallet CLOB API secret |
| `POLYMARKET_PASSPHRASE` | Legacy primary-wallet CLOB passphrase |
| `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` | Per-wallet credential JSON map (B-core) |

`VEX_KEYSTORE_PASSWORD` (`MASTER_PASSWORD_ENV_KEY`) is ephemeral: set
temporarily by `withFreshKeystorePassword` for legacy engine-side wallet
operations that still resolve it from env; deleted in the `finally` block.
It is explicitly deleted from `process.env` inside `applyUnlockedRuntime`
after every vault-apply call to prevent it from lingering.

### In-process (vex-app main)

`unlockedMasterPassword: string | null` — module-level variable in
`vex-app/src/main/secrets/session.ts`. Null before `unlockSecretSession` /
`initializeMasterPassword` and after `lockSecretSession`. JS strings are
immutable; nulling the reference is the strongest in-process defense.

## Boundary crossings

- **Filesystem (read/write)**: `secrets.vault.json` — `readFileSync` (unlock/verify),
  `renameSync(tmp, target)` (atomic write), `chmodSync(target, 0o600)`. Temp file:
  `.secrets.vault.<pid>.<ts>.tmp` in the same directory.
- **`process.env` (write)**: `applySecretVaultToProcessEnv` injects all `VAULT_SECRET_KEYS`
  after decrypt; deletes absent keys. `stripManagedSecretsFromDotenvFile` removes
  managed keys from the `.env` file.
- **Network (Polymarket CLOB API)**: `acquirePolymarketCredentialsWithPassword` calls
  `https://clob.polymarket.com/auth/derive-api-key` (GET, 15s timeout) and
  `/auth/api-key` (POST fallback). No other network calls in this module.
- **`node:crypto`**: `scryptSync`, `createCipheriv("aes-256-gcm")`, `createDecipheriv`,
  `randomBytes` (16-byte salt, 12-byte IV). All synchronous — intentional (blocking
  during unlock is acceptable for an interactive desktop operation).
- **viem** (Polymarket path only): `getAddress` for EVM address normalization;
  `createWalletClient` + `signTypedData` for EIP-712 ClobAuth — dynamically imported in
  `buildL1AuthHeaders` to keep the import tree lazy.

## File map

- `src/lib/local-secret-vault.ts:31 CURRENT_KDF_PARAMS` — `{ name:"scrypt", N:65536,
  r:8, p:1, dkLen:32 }`. Authoritative KDF params for new vaults and rewrites.
- `src/lib/local-secret-vault.ts:97 deriveKey` — wraps `scryptSync` with `maxmem:256 MiB`
  ceiling (bypasses Node's default 32 MiB cap which would reject N=65536).
- `src/lib/local-secret-vault.ts:125 encryptContents` — fresh 16-byte salt + 12-byte IV per
  call; AES-256-GCM cipher; returns `VaultFile` including GCM auth tag.
- `src/lib/local-secret-vault.ts:147 vaultFileNeedsKdfUpgrade` — compares on-disk `kdf`
  block to `CURRENT_KDF_PARAMS`; used in `unlockSecretVault` for opportunistic upgrade.
- `src/lib/local-secret-vault.ts:156 decryptContents` — derives key from FILE's own `kdf`
  block (not `CURRENT_KDF_PARAMS`); wraps all failures as `invalid_password` (both wrong
  pw AND bit-flipped ciphertext are indistinguishable at this layer). AES-GCM auth tag
  is verified by `decipher.final()`; tamper → `invalid_password`.
- `src/lib/local-secret-vault.ts:180 atomicWriteJson` — writes to `.tmp`, `renameSync` to
  final path, `chmodSync 0o600`. Creates parent dir if missing.
- `src/lib/local-secret-vault.ts:197 secretVaultExists` — `existsSync` probe.
- `src/lib/local-secret-vault.ts:207 createSecretVault` — idempotent: if vault exists,
  delegates to `unlockSecretVault` (verifies existing password rather than overwriting).
- `src/lib/local-secret-vault.ts:238 verifySecretVaultPassword` — read-only verify: no KDF
  upgrade, no disk write, discards decrypted payload. Used for sudo-style re-auth on
  sensitive ops (wallet export, Polymarket setup). Error code contract: `missing |
  invalid_password | corrupt | io`.
- `src/lib/local-secret-vault.ts:263 unlockSecretVault` — decrypt + opportunistic KDF upgrade
  rewrite (failure is best-effort: `process.emitWarning`, does NOT block the unlock).
  Returns `LocalSecretVaultContents`.
- `src/lib/local-secret-vault.ts:305 writeSecretVaultSecrets` — read-merge-write: unlocks
  current vault, merges the `updates` partial record (null values DELETE the key; absent
  keys are untouched), re-encrypts with `CURRENT_KDF_PARAMS`, atomic-writes.
- `src/lib/local-secret-vault.ts:332 applySecretVaultToProcessEnv` — unlock + inject all
  `VAULT_SECRET_KEYS` into `process.env` (absent keys are deleted, preventing stale env).
  Returns the decrypted contents to the caller (`applyUnlockedRuntime` discards it).
- `src/lib/local-secret-vault.ts:345 stripManagedSecretsFromDotenvFile` — removes each key
  in `MANAGED_SECRET_ENV_KEYS` from the plaintext `.env` file via `removeFromDotenvFile`.
- `src/lib/secret-keys.ts:1 MASTER_PASSWORD_ENV_KEY` — `"VEX_KEYSTORE_PASSWORD"`.
- `src/lib/secret-keys.ts:3 VAULT_SECRET_KEYS` — `readonly string[]` of 8 keys (see above).
- `src/lib/secret-keys.ts:18 MANAGED_SECRET_ENV_KEYS` — `[MASTER_PASSWORD_ENV_KEY, ...VAULT_SECRET_KEYS]` —
  the full set stripped from `.env` and deleted from `process.env` on lock.
- `src/lib/secret-keys.ts:24 isVaultSecretKey` / `isManagedSecretEnvKey` — type-guard helpers.
- `src/lib/polymarket.ts` — re-export facade providing `@vex-lib/polymarket.js`:
  `acquirePolymarketCredentialsWithPassword`, `deriveAndSavePolymarketCredentials`,
  `AcquireResult`, `AcquiredPolymarketCredentials`, `DeriveResult`,
  `buildPolymarketVaultUpdates`, `parseCredentialMapEnv`, `StoredPolyCredentials`,
  `ENV_POLYMARKET_API_KEY/SECRET/PASSPHRASE`, `ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`.
- `src/tools/polymarket/credential-map.ts:68 parseCredentialMapEnv` — absent/empty → `{}`
  (valid empty map); present-but-malformed → throws `VexError(POLYMARKET_NOT_CONFIGURED)`.
  Fail-closed contract: corruption surfaces instead of silently masquerading as "no creds".
- `src/tools/polymarket/credential-map.ts:58 normalizePolyAddress` — `getAddress(addr).toLowerCase()`.
  Throws on non-address string (viem).
- `src/tools/polymarket/credential-map.ts:102 withCredentialEntry` — pure map merge; returns
  new map with `address` entry set/replaced.
- `src/tools/polymarket/credential-map.ts:125 buildPolymarketVaultUpdates` — SINGLE source
  of truth for which vault keys a Polymarket write touches: ALWAYS merges `creds` into
  the per-address map; for PRIMARY wallets ONLY, ALSO writes three fixed legacy keys
  (`POLYMARKET_API_KEY/SECRET/PASSPHRASE`). Pure — no keystore/vault/env I/O.
- `src/tools/wallet/polymarket-credentials.ts:127 acquirePolymarketCredentialsWithPassword` —
  env-free: decrypts keystore with explicit password, asserts derived address matches
  `entry.address` (fail closed), signs EIP-712 ClobAuth, tries `/auth/derive-api-key`
  (GET), falls back to `/auth/api-key` (POST). Returns credentials in memory; NO vault /
  .env / `process.env` side effects.
- `src/tools/wallet/polymarket-credentials.ts:212 deriveAndSavePolymarketCredentials` —
  legacy env-driven entry point (engine internal tool `polymarket_setup`): resolves
  master password from `process.env.VEX_KEYSTORE_PASSWORD`, calls acquire primitive,
  calls `buildPolymarketVaultUpdates`, calls `writeSecretVaultSecrets` + `stripManagedSecretsFromDotenvFile`
  + mirrors written keys into `process.env`. NOT used by the Electron app.

## Key types & invariants

- `CURRENT_KDF_PARAMS` (`local-secret-vault.ts:31`) — `{ N:65536, r:8, p:1, dkLen:32 }`.
  N=65536 is a deliberate desktop compromise: ~200ms on commodity hardware vs OWASP
  minimum recommendation of N≥131072 (~400ms). **OWASP gap: N=65536 is 2× below the
  current OWASP interactive guideline (N=2^17=131072).** See Security section.
- `vaultFileSchema` (`local-secret-vault.ts:39`) — strict Zod schema; `kdf` block is stored
  per-file so legacy vaults remain decryptable after a `CURRENT_KDF_PARAMS` bump.
- `LocalSecretVaultError` (`local-secret-vault.ts:82`) — typed error with codes:
  `missing | invalid_password | corrupt | io`. `invalid_password` covers BOTH wrong
  password AND bit-flipped ciphertext (GCM tag mismatch). `corrupt` covers structural
  JSON/schema failure only.
- `VAULT_SECRET_KEYS` (`secret-keys.ts:3`) — the closed list; adding a new secret
  requires updating this array to have `applySecretVaultToProcessEnv` include it.
- `MANAGED_SECRET_ENV_KEYS` = `[MASTER_PASSWORD_ENV_KEY, ...VAULT_SECRET_KEYS]` — the
  full set that must NEVER persist in the plaintext `.env`.
- `StoredPolyCredentials` (`credential-map.ts:34`) — `{ apiKey, apiSecret, passphrase }`.
  Note: `AcquiredPolymarketCredentials` (`polymarket-credentials.ts:95`) uses `secret`
  (not `apiSecret`); the caller maps `secret → apiSecret` when building `StoredPolyCredentials`.
- `buildPolymarketVaultUpdates` invariant: non-primary wallet writes ONLY the map key;
  primary ALSO writes three fixed keys (backward-compat legacy read fallback).

## Capabilities (stable IDs)

- **CAP-vault-create**: Initialize a new vault (idempotent: unlocks if exists)
  — `local-secret-vault.ts:207 createSecretVault`
- **CAP-vault-unlock**: Decrypt vault, inject all secrets into `process.env`,
  delete master password from env, strip managed keys from `.env`
  — `local-secret-vault.ts:263 unlockSecretVault` + `local-secret-vault.ts:332 applySecretVaultToProcessEnv`
- **CAP-vault-verify-password**: Sudo-style re-auth: decrypt and discard, no disk write,
  no env mutation — `local-secret-vault.ts:238 verifySecretVaultPassword`
- **CAP-vault-write-secrets**: Read-merge-write secrets into the vault under master password;
  `null` value deletes a key — `local-secret-vault.ts:305 writeSecretVaultSecrets`
- **CAP-vault-kdf-upgrade**: Opportunistic re-encrypt with `CURRENT_KDF_PARAMS` on unlock
  when on-disk params are weaker; failure is best-effort
  — `local-secret-vault.ts:285 vaultFileNeedsKdfUpgrade` (inside `unlockSecretVault`)
- **CAP-vault-strip-env**: Remove managed secrets from plaintext `.env` file
  — `local-secret-vault.ts:345 stripManagedSecretsFromDotenvFile`
- **CAP-vault-key-registry**: Closed list of vault keys + master-pw key + type guards
  — `secret-keys.ts` (entire file)
- **CAP-polymarket-acquire-creds**: Env-free credential acquisition: keystore decrypt →
  EIP-712 sign → CLOB API call → credentials in memory
  — `polymarket-credentials.ts:127 acquirePolymarketCredentialsWithPassword`
- **CAP-polymarket-derive-save**: Legacy env-driven full flow: acquire + vault persist +
  env strip + in-process env apply
  — `polymarket-credentials.ts:212 deriveAndSavePolymarketCredentials`
- **CAP-polymarket-cred-map-build**: SSOT for which vault keys a Polymarket write touches
  (map merge + primary-only fixed keys)
  — `credential-map.ts:125 buildPolymarketVaultUpdates`
- **CAP-polymarket-cred-map-parse**: Fail-closed parse of `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`
  env value — `credential-map.ts:68 parseCredentialMapEnv`
- **CAP-polymarket-facade**: `@vex-lib/polymarket.js` re-export surface
  — `lib/polymarket.ts`

## Public API (consumed by)

### vex-app main process (via `@vex-lib/*` aliases)

| Caller | Entry point | Notes |
|---|---|---|
| `vex-app/src/main/secrets/session.ts` | All vault + key functions; `parseCredentialMapEnv` | Central session orchestrator |
| `vex-app/src/main/ipc/wallet-export.ts` | `verifySecretVaultPassword` | Sudo re-auth before key decrypt |
| `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` | `acquirePolymarketCredentialsWithPassword`, `buildPolymarketVaultUpdates`, `verifySecretVaultPassword` | One-click Polymarket setup |
| `vex-app/src/main/onboarding/provider-writer.ts` | `stripManagedSecretsFromDotenvFile` | After writing provider config |
| `vex-app/src/main/onboarding/embedding-writer.ts` | `stripManagedSecretsFromDotenvFile` | After writing embedding config |
| `vex-app/src/main/onboarding/agent-core-writer.ts` | `stripManagedSecretsFromDotenvFile` | After writing agent-core config |
| `vex-app/src/main/onboarding/wallet-password.ts` | `MASTER_PASSWORD_ENV_KEY` | For `withFreshKeystorePassword` env injection |

### Engine / root src (direct imports)

| Caller | Entry point | Notes |
|---|---|---|
| `src/tools/wallet/polymarket-credentials.ts` | `writeSecretVaultSecrets`, `stripManagedSecretsFromDotenvFile` | `deriveAndSavePolymarketCredentials` persist step |
| `src/vex-agent/tools/protocols/polymarket/auth.ts` | `parseCredentialMapEnv` (via `@tools/polymarket/credential-map.js`) | Read creds from env for CLOB API auth |

## Internal flow

### Unlock sequence (triggered by `vex:secrets:unlock`)

1. `unlockSecretSession(password)` in `secrets/session.ts`:
   - calls `unlockSecretVault(password, { filePath })` — reads vault file, Zod-validates,
     derives key from file's own `kdf` block via `scryptSync`, AES-GCM decrypt + tag verify.
   - On success: opportunistic KDF upgrade (re-encrypt if `vaultFileNeedsKdfUpgrade`; failure
     → `process.emitWarning`, vault still usable).
   - stores `unlockedMasterPassword = password`.
   - calls `applyUnlockedRuntime(password)`:
     - `applySecretVaultToProcessEnv(password)` — injects all `VAULT_SECRET_KEYS` into
       `process.env`; deletes absent keys.
     - `delete process.env[MASTER_PASSWORD_ENV_KEY]` — removes master pw from env.
   - calls `stripManagedSecretsFromDotenvFile(ENV_FILE)` — removes managed keys from `.env`.
2. Returns `ok({ unlocked: true })` to the IPC caller.
3. Inference registry now finds `OPENROUTER_API_KEY` in `process.env` → `resolveProvider()`
   succeeds on next call.

### Write + re-apply sequence (after onboarding steps or Polymarket setup)

1. Writer (e.g. `polymarket-setup.ts` step 7) calls `writeUnlockedSecrets(updates)`.
2. `writeUnlockedSecrets` in `secrets/session.ts`:
   - asserts `unlockedMasterPassword !== null`.
   - calls `writeSecretVaultSecrets(password, updates)` — read-merge-write under CURRENT_KDF_PARAMS.
   - calls `applyUnlockedRuntime(password)` — re-injects ALL vault keys (including newly written ones).
   - calls `stripManagedSecretsFromDotenvFile(ENV_FILE)` — defensive re-strip.
3. For Polymarket writes, this happens INSIDE `withEnvWriteLock` to prevent interleaving
   with concurrent onboarding steps.

### Polymarket credential setup (IPC `vex:onboarding:polymarketAutoSetup`)

1. Session must be unlocked (`getSecretSessionStatus().unlocked`).
2. Resolve target wallet from `input.walletId` via inventory (fail closed on null).
3. Pre-network overwrite check: `getConfiguredPolymarketAddresses()` → `parseCredentialMapEnv`
   (reads live `process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS]`).
4. Sudo re-auth: `verifySecretVaultPassword(input.password)` — no disk write, no env change.
5. `acquirePolymarketCredentialsWithPassword(password, entry)`:
   - Loads `entry`'s keystore file.
   - Decrypts with explicit `password` via `decryptPrivateKey`.
   - Asserts `privateKeyToAddress(key) === entry.address` (Codex B-core ruling — fail closed).
   - Scrubs `privateKey` binding immediately after signer consumes it (`finally`).
   - Signs EIP-712 ClobAuth (domain `ClobAuthDomain` chainId 137, nonce 0).
   - GET `/auth/derive-api-key` with L1 auth headers (15s timeout); falls back to POST
     `/auth/api-key` on non-2xx or network error.
   - Returns `{ address, credentials }` — NO vault/env side effects.
6. INSIDE `withEnvWriteLock`:
   - TOCTOU re-check: `getConfiguredPolymarketAddresses()` again; back out without writing
     if the wallet was configured between steps 3 and 6 and `overwriteConfirmed` is false.
   - `buildPolymarketVaultUpdates({ currentMapEnv, address, creds, isPrimary })`:
     - `parseCredentialMapEnv(currentMapEnv)` → existing map.
     - `withCredentialEntry(map, address, creds)` → new map.
     - If `isPrimary`: also set three fixed legacy keys.
   - `writeUnlockedSecrets(updates)` — vault write + env re-inject + .env strip.
7. `acquired = null` — drop credentials reference ASAP (JS can't zero buffer; shortest lifetime).
8. Audit log: `address=<X> correlationId=<id>` only. NEVER credential values.

### Lock sequence

1. `lockSecretSession()`: `unlockedMasterPassword = null`; optional `global.gc()`.
2. `process.env` is NOT cleared (no inverse of `applySecretVaultToProcessEnv` on lock).
   Vault secrets remain in env until the process exits or until the next
   `applySecretVaultToProcessEnv` call (which deletes absent-value keys).
   **This is a known limitation** — see Open questions #2.

## Dependencies

### Imports FROM

- `src/config/paths.ts` — `ENV_FILE`, `SECRETS_VAULT_FILE` (config dir paths)
- `src/utils/dotenv.ts` — `removeFromDotenvFile` (for `.env` strip)
- `src/lib/secret-keys.ts` — `VAULT_SECRET_KEYS`, `MANAGED_SECRET_ENV_KEYS`, `VaultSecretKey`
- `src/errors.ts` — `VexError`, `ErrorCodes` (credential-map and polymarket-credentials)
- `src/tools/polymarket/constants.ts` — env var name constants, `CLOB_BASE_URL`, `CLOB_TIMEOUT_MS`
- `src/utils/http.ts` — `fetchWithTimeout`, `readJson`
- `src/utils/env.ts` — `requireKeystorePassword` (legacy engine path only)
- `src/utils/validation-helpers.ts` — `isRecord`
- `src/tools/wallet/keystore.ts` — `loadKeystore`, `loadKeystoreFile`, `decryptPrivateKey`
- `src/config/store.ts` — `loadConfig`, `WalletInventoryEntry`
- `src/tools/wallet/inventory.ts` — `derivePath`, `getPrimaryEvmAddress`, `getPrimaryEvmEntry`, `getWalletById`
- `viem` (credential-map): `getAddress`
- `viem` / `viem/accounts` / `viem/chains` (polymarket-credentials): dynamically imported

### Consumed BY

#### In-tree (direct)
- `src/tools/wallet/polymarket-credentials.ts` — `writeSecretVaultSecrets`, `stripManagedSecretsFromDotenvFile`
- `src/vex-agent/tools/protocols/polymarket/auth.ts` — `parseCredentialMapEnv` (via alias)

#### vex-app main (via `@vex-lib/*` aliases)
- `vex-app/src/main/secrets/session.ts` — primary consumer; orchestrates the full lock/unlock/write lifecycle
- `vex-app/src/main/ipc/wallet-export.ts` — `verifySecretVaultPassword`
- `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` — acquire + build + verify
- `vex-app/src/main/onboarding/{provider,embedding,agent-core}-writer.ts` — `stripManagedSecretsFromDotenvFile`
- `vex-app/src/main/onboarding/wallet-password.ts` — `MASTER_PASSWORD_ENV_KEY`

## Cross-references

- **Decision**: `decisions/ADR-0001-global-model-session-wallet` — `OPENROUTER_API_KEY` is the
  vault secret that enables global provider resolution; it is injected at vault unlock and
  consumed by `inference/registry.ts:doResolve()`. Any per-session model proposal would
  also need per-session key handling — a structural dependency on this module.
- **Related module**: `module.vex-agent.inference` — `process.env.OPENROUTER_API_KEY` is the
  direct connection point. The inference module's `null-not-cached` invariant
  (resolveProvider retries on each call when no key present) is designed to recover after
  vault unlock injects the key.
- **Related module**: `module.src-root.lib-wallet` — `polymarket-credentials.ts` imports
  `loadKeystore`, `decryptPrivateKey`, and inventory helpers from the wallet module.
  The wallet module's keystore KDF uses N=16384 (weaker than vault N=65536 — flagged).
- **Related module**: `module.src-root.lib-env-config` — `stripManagedSecretsFromDotenvFile`
  is called after every env write to maintain the invariant that managed secrets never
  persist in the plaintext `.env` that `lib-env-config` reads.
- **vex-app coverage**: `audits/current/coverage-gaps.md#CAP-vault-unlock` etc.
- **quality findings**: `audits/current/quality-findings.md#FINDING-vault-001` (KDF N gap)
  `#FINDING-vault-002` (env not cleared on lock)

## Security notes

### KDF parameters — OWASP divergence

`CURRENT_KDF_PARAMS`: N=65536, r=8, p=1, dkLen=32.

Current OWASP recommendation for interactive `scrypt`: N ≥ 2^17 (131072), r=8, p=1
(~400ms). The vault uses N=65536 (2^16), which is **2× below the current OWASP
interactive guideline**. The code comment acknowledges this explicitly: "deliberate
compromise between OWASP guidance and ~200ms on commodity hardware."

The `vaultFileNeedsKdfUpgrade` mechanism is already in place to migrate existing
vaults opportunistically. Upgrading `CURRENT_KDF_PARAMS.N` from 65536 to 131072 would
double unlock time (~400ms) and bring it into OWASP compliance; the migration path
exists. No immediate exploitability — an offline attacker who obtains the vault file
has 2× more work with N=131072 than N=65536. For comparison, the wallet keystore uses
N=16384 (4× weaker than the vault), flagged in Z5 findings.

Salt: 16 bytes (random per encrypt call). IV: 12 bytes (random per encrypt call).
Both are appropriate for AES-256-GCM.

### Secret leakage paths (assessed)

| Path | Verdict |
|---|---|
| `decryptContents` error messages | SAFE: `invalid_password` code only; no key material in message |
| `atomicWriteJson` IO error | SAFE: error is the OS error, not vault contents |
| KDF upgrade `process.emitWarning` | SAFE: only logs the OS error message, not key/plaintext |
| `deriveAndSavePolymarketCredentials` return | SAFE: returns `apiKeyPrefix` (first 8 chars + `…`), NOT full key |
| Polymarket setup audit log | SAFE: logs `address=<addr>` + `correlationId` only; credentials dropped before log call |
| `getUnlockedSecretPresence` | SAFE: returns `boolean` per key, never values |
| `getConfiguredPolymarketAddresses` | SAFE: returns lowercased addresses only, never credential values |
| `decryptContents` → `vaultContentsSchema.parse` | SAFE: Zod parses into a plain object, no serialization back to logs |
| `buildL1AuthHeaders` error path | SAFE: privateKey scrubbed in `finally` before any error propagates |

### `VEX_KEYSTORE_PASSWORD` env injection

`withFreshKeystorePassword` (`wallet-password.ts`) temporarily sets
`process.env[MASTER_PASSWORD_ENV_KEY]` for the duration of a single engine-side wallet
call and deletes it in `finally`. This is a bridge for legacy engine code that resolves
the password from env (`requireKeystorePassword`). The Electron app's own vault/Polymarket
paths do NOT use this mechanism — they pass the password explicitly. Risk: a process crash
during the `try` block could leave the env var set; this is the same risk as any
in-process secret. No logging of the value is present.

### AES-GCM tag validation

`decryptContents` calls `decipher.setAuthTag(tag)` before `decipher.final()`. Node's
AES-256-GCM will throw on tag mismatch (tampering/corruption) inside `decipher.final()`.
This throw is caught and re-wrapped as `invalid_password`. An attacker who can flip bits
in the ciphertext gets `invalid_password` (indistinguishable from wrong password) — the
correct behavior for GCM integrity protection.

## Open questions

1. **KDF upgrade path**: `CURRENT_KDF_PARAMS.N = 65536` is below OWASP interactive
   recommendation (131072). The migration infrastructure (`vaultFileNeedsKdfUpgrade` +
   `unlockSecretVault` opportunistic rewrite) already exists. Decision: bump N to 131072
   to reach OWASP compliance (~400ms on commodity desktop). Would be a one-time transparent
   rewrite on next unlock. Cross-reference `audits/current/quality-findings.md#FINDING-vault-001`.
2. **Vault secrets not cleared from `process.env` on `lockSecretSession`**: `lockSecretSession()`
   nulls `unlockedMasterPassword` but does NOT iterate `VAULT_SECRET_KEYS` and delete them
   from `process.env`. Vault secrets (including `OPENROUTER_API_KEY`) remain in env after
   lock. The engine's inference singleton is not flushed. A locked-session user can still
   trigger inference if an in-flight request was initiated before lock. Low exploitability
   (local desktop; user locked themselves). Cross-reference `audits/current/quality-findings.md#FINDING-vault-002`.
3. **`verifySecretVaultPassword` vs `unlockSecretVault` double-decrypt**: Both `polymarket-setup.ts`
   and `wallet-export.ts` call `verifySecretVaultPassword` for re-auth and then `writeUnlockedSecrets`
   (which calls `unlockSecretVault` again internally). This is two full scrypt derivations. At
   N=65536 that's ~400ms total per operation on commodity hardware. At N=131072 it would be ~800ms.
   Acceptable for a one-shot interactive sudo re-auth flow; worth noting if N is bumped.
4. **`acquired` credential null-out race**: In `polymarket-setup.ts`, `acquired = null` runs after
   `withEnvWriteLock` resolves (step 8). If the lock's async fn throws internally and the catch
   path returns early from `persistOutcome.write_failed`, `acquired` is NOT yet nulled (the
   `acquired = null` line after the `await withEnvWriteLock(...)` block is not reached for the
   early-return branches). Minor: `acquired` goes out of scope when the handler returns. No
   actual leakage but worth confirming the lifetime is understood.

## Refresh triggers

- Any file in `src/lib/local-secret-vault.ts` or `src/lib/secret-keys.ts` (direct scope).
- `src/tools/polymarket/credential-map.ts` or `src/tools/wallet/polymarket-credentials.ts` (direct scope).
- `src/tools/polymarket/constants.ts` — env var name constants; drift would break the map key.
- `src/config/paths.ts` — `SECRETS_VAULT_FILE` path change would break all vault I/O.
- `src/utils/dotenv.ts` — `removeFromDotenvFile` contract change would break `.env` strip.
- `vex-app/src/main/secrets/session.ts` — primary consumer; orchestration changes affect the
  unlock/write/strip flow documented here.
- `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` — Polymarket flow changes.
- `vex-app/src/main/ipc/wallet-export.ts` — sudo re-auth pattern changes.
