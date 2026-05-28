---
id: module.src-root.lib-wallet
kind: module
paths:
  - "src/lib/wallet.ts"
  - "src/lib/wallet-backup.ts"
  - "src/tools/wallet/keystore.ts"
  - "src/tools/wallet/solana-keystore.ts"
  - "src/tools/wallet/inventory.ts"
  - "src/tools/wallet/inventory-create.ts"
  - "src/tools/wallet/multi-auth.ts"
  - "src/tools/wallet/signingClient.ts"
  - "src/tools/wallet/client.ts"
  - "src/tools/wallet/create.ts"
  - "src/tools/wallet/import.ts"
  - "src/tools/wallet/solana-create.ts"
  - "src/tools/wallet/solana-import.ts"
  - "src/tools/wallet/backup.ts"
  - "src/tools/wallet/auth.ts"
  - "src/tools/wallet/family.ts"
  - "src/tools/wallet/native-balances.ts"
  - "src/config/store.ts"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/lib/wallet.ts"
  - "src/lib/wallet-backup.ts"
  - "src/tools/wallet/**"
  - "src/config/store.ts"
  - "src/config/paths.ts"
  - "src/utils/env.ts"
  - "src/lib/secret-keys.ts"
related:
  - module.src-root.lib-vault-secrets
  - module.src-root.lib-env-config
  - module.vex-agent.tools-internal
  - module.vex-agent.tools-protocols
  - ADR-0001-global-model-session-wallet
---

# module.src-root.lib-wallet — User Wallet Keystore, Inventory, and Multi-Auth

## Purpose

Owns the full user hot-wallet stack for the Vex desktop app: AES-256-GCM / scrypt
key encryption (EVM + Solana), a two-layer inventory (per-family config arrays
backed by per-id keystore files on disk), session-scoped wallet resolution with
fail-closed address-snapshot pinning, sudo-style export, and a read-only viem
public and signing client factory. The facade `src/lib/wallet.ts` re-exports the
canonical primitives so `vex-app` main can pull everything through the `@vex-lib`
alias without reaching outside the alias scope. No private key material ever
crosses the `src → renderer` boundary.

## Retrieval keywords

- user wallet, hot wallet, keystore, EVM wallet, Solana wallet
- AES-256-GCM, scrypt, KDF, N=16384, scrypt params, KDF params
- wallet inventory, WalletInventoryEntry, per-family cap, multi-wallet
- WalletResolution, session-scoped wallet, source session, fail-closed drift
- isValidWalletId, path traversal guard, wallet id validation, WALLET_ID_PATTERN
- resolveSelectedEntry, resolveWalletForFamily, loadWalletFromEntry
- loadEvmKey, loadEvmSecret, loadSolanaSecret, signer mismatch, address verification
- decryptExportSecret, sudo export, Solana zeroize, clipboard
- derivePath, CONFIG_DIR, wallet-<id>.json, legacy keystore, evm_legacy, sol_legacy
- createWallet, importWallet, createSolanaWallet, importSolanaWallet
- createEvmWalletEntry, importEvmWalletEntry, createSolanaWalletEntry, importSolanaWalletEntry
- autoBackup, backup retention, MAX_BACKUPS=20
- getPublicClient, viem public client, getSigningClient, viem wallet client
- requireKeystorePassword, VEX_KEYSTORE_PASSWORD, master password
- WalletPolicy, WalletResolution, mission_allowed, fail-closed on invalid policy
- VexConfig, config.json, chain config, services, wallet section normalization
- normalizeWalletSection, legacy wallet migration, evm_legacy, sol_legacy

## State owned

- `${CONFIG_DIR}/config.json` — `VexConfig` (chain, services, `wallet.{evm,solana}` inventory arrays, solana RPC, polymarket, claude). No private keys. Updated atomically via `saveConfig` / `saveConfigPatch`.
- `${CONFIG_DIR}/keystore.json` — legacy EVM keystore (`KeystoreV1`, AES-256-GCM+scrypt). `evm_legacy` entries use this fixed path.
- `${CONFIG_DIR}/solana-keystore.json` — legacy Solana keystore. `sol_legacy` entries use this fixed path.
- `${CONFIG_DIR}/wallet-<id>.json` — per-id keystores for non-legacy wallets. Path derived via `derivePath`; id validated by `isValidWalletId` before derivation.
- `${CONFIG_DIR}/backups/<timestamp>/` — rolling timestamped backup dirs (max 20, enforced by `enforceBackupRetention`).

## Boundary crossings

- **Filesystem**: keystore read/write (`loadKeystoreFile` / `saveKeystoreFile`), config read/write (`loadConfig` / `saveConfig`), backup copy (`autoBackup`). All keystore writes are atomic: write to `.${base}.tmp.${Date.now()}.json`, `chmod 0o600` (non-Windows), then `renameSync`. All config writes are atomic: `.config.tmp.<ts>.json` → `renameSync`.
- **process.env**: `requireKeystorePassword()` reads `VEX_KEYSTORE_PASSWORD` (`MASTER_PASSWORD_ENV_KEY` from `src/lib/secret-keys.ts`). This env var is set by `vex-app/src/main/secrets/session.ts` post-vault-unlock; never persisted to `.env`; cleared from env by `applyUnlockedRuntime` after it is injected into `process.env`.
- **EVM RPC** (viem): `getPublicClient()` creates a viem `PublicClient` for the configured chain; `getSigningClient(privateKey)` creates a viem `WalletClient`. Note: `getSigningClient` has **no active callers** in the repo — the engine EVM signing path uses `createDynamicWalletClient` from `@tools/khalani/evm-client.js` instead. `getPublicClient` has no callers in vex-agent or vex-app main; may be CLI/test only.
- **Solana**: `Keypair.fromSecretKey` / `Keypair.generate` via `@solana/web3.js` for derivation and generation; bs58 encode/decode for import normalization.
- **viem/accounts**: `generatePrivateKey`, `privateKeyToAddress`, `privateKeyToAccount` for EVM key operations.
- **node:crypto**: `scryptSync`, `createCipheriv`, `createDecipheriv`, `randomBytes`, `randomUUID` — all standard Node.

## File map

### Facades and re-exports

- `src/lib/wallet.ts:1` — `@vex-lib/wallet.js` facade. Re-exports ALL wallet primitives: keystore, solana-keystore, inventory, inventory-create, backup, config/store (VexConfig, WalletInventoryEntry, loadConfig, saveConfig), paths constants, `VexError`/`ErrorCodes`, and `privateKeyToAddress` from viem. No new logic; pure cross-boundary bridge.
- `src/lib/wallet-backup.ts:1` — thin re-export of `autoBackup` only, for `@vex-lib/wallet-backup` alias used by onboarding finalize.

### Keystore (EVM + shared crypto)

- `src/tools/wallet/keystore.ts:10` `KeystoreV1` — on-disk format: version(1), ciphertext(base64), iv(12-byte base64), salt(32-byte base64), tag(16-byte GCM-auth base64), kdf(scrypt params).
- `src/tools/wallet/keystore.ts:25` `KDF_PARAMS` — **N=2^14=16384, r=8, p=1, dkLen=32**. See Security note below.
- `src/tools/wallet/keystore.ts:33` `deriveKey` — `scryptSync(password, salt, dkLen, {N,r,p})`.
- `src/tools/wallet/keystore.ts:53` `encryptPrivateKey` — normalizes hex PK → `encryptSecretBytes`.
- `src/tools/wallet/keystore.ts:58` `encryptSecretBytes` — random 32-byte salt + 12-byte IV, AES-256-GCM, returns `KeystoreV1`. Shared by EVM and Solana paths.
- `src/tools/wallet/keystore.ts:83` `decryptPrivateKey` — delegates to `decryptSecretBytes`, hex-encodes result.
- `src/tools/wallet/keystore.ts:88` `decryptSecretBytes` — validates version=1, derives key via stored KDF params, AES-256-GCM decrypt; throws `VexError(KEYSTORE_DECRYPT_FAILED)` on auth-tag failure (wrong password or corruption).
- `src/tools/wallet/keystore.ts:124` `saveKeystoreFile(path, keystore)` — atomic tmp→rename, `chmod 0o600` (non-Windows). `saveKeystore` wraps with `KEYSTORE_FILE` default.
- `src/tools/wallet/keystore.ts:177` `loadKeystoreFile(path)` — null if not found; structural validation via `validateKeystoreShape`; throws `VexError(KEYSTORE_CORRUPT)` on parse failure. `loadKeystore` wraps with `KEYSTORE_FILE` default.
- `src/tools/wallet/keystore.ts:41` `normalizePrivateKey` — strips `0x`, validates 64-hex-char format, returns `0x<lower>` as `Hex`. Rejects keys with wrong length.

### Solana keystore

- `src/tools/wallet/solana-keystore.ts:14` `SOLANA_SECRET_KEY_LENGTH=64` — full keypair (32-byte private + 32-byte public).
- `src/tools/wallet/solana-keystore.ts:36` `normalizeSolanaSecretKey` — accepts JSON byte array `[0..255]×64` OR base58-encoded 64-byte key; validates length; throws `VexError(INVALID_PRIVATE_KEY)`.
- `src/tools/wallet/solana-keystore.ts:60` `encryptSolanaSecretKey` — delegates to `encryptSecretBytes` (same KDF: N=16384).
- `src/tools/wallet/solana-keystore.ts:67` `decryptSolanaSecretKey` — delegates to `decryptSecretBytes`; validates 64-byte length post-decrypt.
- `src/tools/wallet/solana-keystore.ts:75` `deriveSolanaAddress` — `Keypair.fromSecretKey(secretKey).publicKey.toBase58()`.
- `src/tools/wallet/solana-keystore.ts:79` `encodeSolanaSecretKey` — bs58 encode; validates 64-byte length.

### Inventory (config-side registry)

- `src/config/store.ts:17` `WalletInventoryEntry` — `{id, address, label, createdAt, legacy?}`. No key material.
- `src/config/store.ts:36` `isValidWalletId(family, id, legacy)` — **path-traversal guard** and family-binding validator. `legacy=true` → only `evm_legacy` or `sol_legacy` accepted. `legacy=false` → must be `evm_<uuid>` or `sol_<uuid>` (UUID pattern `^[0-9a-f]{8}-...-[0-9a-f]{12}$`). Rejects any `/`, `\`, `.`, or cross-family prefix. Called in both `parseEntryArray` (config normalization, drops invalid rows) and `derivePath` (refuses to build a path for non-canonical id).
- `src/config/store.ts:54` `VexConfig` — full config shape: version(1), chain, wallet, services, solana, polymarket?, claude?. Wallet arrays hold only metadata; keystore files hold secrets.
- `src/config/store.ts:180` `normalizeWalletSection` — accepts new array shape OR legacy `{address, solanaAddress}` flat shape (synthesizes `evm_legacy`/`sol_legacy` entries). Malformed entries dropped with warning (no throw), allowing safe load even with partial corruption.
- `src/config/store.ts:226` `loadConfig` — merge-with-defaults pattern; unknown version falls back to defaults. Atomic on save. Strips legacy `watchlist` field.
- `src/tools/wallet/inventory.ts:44` `familyToInventory(ChainFamily) → InventoryFamily` — maps `"eip155"` to `"evm"`, `"solana"` to `"solana"`.
- `src/tools/wallet/inventory.ts:54` `walletAddressesEqual(family, a, b)` — EVM: case-insensitive; Solana: exact. Used in address-drift detection and export verification.
- `src/tools/wallet/inventory.ts:60` `listWallets`, `getWalletById`, `getPrimaryEvmEntry`, `getPrimarySolanaEntry`, `getPrimaryEvmAddress`, `getPrimarySolanaAddress` — read-only config accessors.
- `src/tools/wallet/inventory.ts:102` `derivePath(family, entry)` — resolves on-disk keystore path. Legacy → fixed constant (id ignored). Non-legacy → `CONFIG_DIR/wallet-<id>.json` after re-validating via `isValidWalletId`. Throws `VexError(WALLET_ID_INVALID)` on non-canonical id.
- `src/tools/wallet/inventory.ts:120` `generateWalletId(family)` — `evm_<randomUUID>` or `sol_<randomUUID>`.
- `src/tools/wallet/inventory.ts:127` `loadEvmSecret(entry)` — derives path → `loadKeystoreFile` → `decryptPrivateKey(requireKeystorePassword())`.
- `src/tools/wallet/inventory.ts:139` `loadSolanaSecret(entry)` — derives path → `loadKeystoreFile` → `decryptSolanaSecretKey(requireKeystorePassword())`.
- `src/tools/wallet/inventory.ts:157` `loadEvmKey(entry)` — **decrypt + address verify**: calls `loadEvmSecret`, then asserts `privateKeyToAddress(pk) === getAddress(entry.address)`. Throws `VexError(SIGNER_MISMATCH)` on mismatch — fail-closed before any signing. Shared by `auth.ts` primary path and `multi-auth.ts` session path.
- `src/tools/wallet/inventory.ts:179` `decryptExportSecret(args)` — **sudo export primitive**: derives path, decrypts with CALLER-SUPPLIED password (not the session env var), verifies derived-address === recorded address (fail-closed), returns `{secret, format}`. EVM: returns hex private key. Solana: returns base58-encoded secret key with `secretKey.fill(0)` in `finally` to zeroize the plaintext buffer. Mismatch throws `VexError(SIGNER_MISMATCH)` before return.
- `src/tools/wallet/inventory.ts:231` `assertCanAddWallet(family, address, cfg)` — enforces `MAX_WALLETS_PER_FAMILY=3` cap and rejects duplicate addresses (EVM: case-insensitive).
- `src/tools/wallet/inventory.ts:258` `registerPrimaryLegacyWallet(family, address)` — upserts the single `*_legacy` entry at index 0 of the family array. Used by create/import legacy paths.

### Inventory mutations (create / import / export)

- `src/tools/wallet/inventory-create.ts:48` `appendWalletEntry(family, address, keystore, label?)` — shared tail for non-legacy wallet additions: validates cap+duplicate, mints non-reusable id (`generateWalletId`), writes `wallet-<id>.json` via `saveKeystoreFile(derivePath(...))`, appends entry to config, persists. Returns entry — no key material. Rejects labels >120 chars before any write (config normalizer drops them silently on re-load; this prevents silent data loss).
- `src/tools/wallet/inventory-create.ts:78` `createEvmWalletEntry` — `generatePrivateKey` → `encryptPrivateKey` → `appendWalletEntry`.
- `src/tools/wallet/inventory-create.ts:85` `importEvmWalletEntry` — `normalizePrivateKey` → `encryptPrivateKey` → `appendWalletEntry`.
- `src/tools/wallet/inventory-create.ts:95` `createSolanaWalletEntry` — `Keypair.generate()` → `encryptSolanaSecretKey` → `appendWalletEntry`.
- `src/tools/wallet/inventory-create.ts:107` `importSolanaWalletEntry` — `normalizeSolanaSecretKey` → `encryptSolanaSecretKey` → `appendWalletEntry`.
- `src/tools/wallet/inventory-create.ts:137` `exportAllWallets(destDir)` — copies encrypted keystore files + writes a sanitized `manifest.json` (id/family/address/label/createdAt/legacy only — no key material, no config.json). Manifest written LAST so a copy failure throws before a "complete" manifest is produced.

### Multi-auth (session-scoped resolution)

- `src/tools/wallet/multi-auth.ts:82` `WalletResolution` — **discriminated union**: `{source:"session", evm:{id,address}|null, solana:{id,address}|null}` | `{source:"default"}`. Engine sessions ALWAYS use `source:"session"`. `source:"default"` is reserved for trusted maintenance paths (no session scope). A null family selection in a `session` resolution throws `WALLET_NOT_SELECTED` (fail-closed — no fall-through to primary).
- `src/tools/wallet/multi-auth.ts:106` `resolveSelectedEntry(family, resolution)` — address-only resolution (no decrypt). Validates: (1) wallet still exists in inventory by id; (2) recorded address matches session snapshot. Throws `VexError(WALLET_SCOPE_MISMATCH)` on address drift — **fail-closed on drift semantics** (prevents signing with a key that was force-re-imported under the same id). Returns `{family: InventoryFamily, entry}`.
- `src/tools/wallet/multi-auth.ts:151` `loadWalletFromEntry(family, entry)` — decrypt + build `ChainWallet` from an already-resolved entry. Separated from `resolveSelectedEntry` so address-only callers skip decryption.
- `src/tools/wallet/multi-auth.ts:163` `resolveWalletForFamily(family, resolution)` — composition of `resolveSelectedEntry` + `loadWalletFromEntry`. Used by engine signing callers and trusted maintenance paths.
- `src/tools/wallet/multi-auth.ts:18-67` `EvmWallet`, `SolanaWallet`, `ChainWallet` — strongly-typed wallet structs with family discriminant.
- `src/tools/wallet/multi-auth.ts:53` `requireEvmWallet()` — primary EVM wallet, no session scope. Delegates to `requireWalletAndKeystore()` (auth.ts).
- `src/tools/wallet/multi-auth.ts:58` `requireSolanaWallet()` — primary Solana wallet, no session scope. Uses `getPrimarySolanaEntry()`.
- `src/tools/wallet/multi-auth.ts:70` `requireWalletForChain(family)` — dispatches to `requireEvmWallet` or `requireSolanaWallet`.

### Auth (primary path)

- `src/tools/wallet/auth.ts:12` `requireWalletAndKeystore()` — resolves index-0 EVM entry → `loadEvmKey`. Back-compat for pre-multi-wallet callers and the primary (non-session-scoped) path. Legacy installs: the single `evm_legacy` entry at index 0.

### Backup

- `src/tools/wallet/backup.ts:43` `autoBackup()` — copies `keystore.json`, `solana-keystore.json`, `config.json` (whichever exist) into a timestamped directory under `BACKUPS_DIR`. Writes `manifest.json` (version, cliVersion, createdAt, walletAddress, solanaWalletAddress, chainId, files). Calls `enforceBackupRetention()`. Returns backup path or null (nothing to backup). Throws `VexError(AUTO_BACKUP_FAILED)` on write failure.
- `src/tools/wallet/backup.ts:104` `enforceBackupRetention()` — best-effort; removes oldest dirs when count > `MAX_BACKUPS=20`.

### Clients

- `src/tools/wallet/signingClient.ts:6` `getSigningClient(privateKey)` — creates a viem `WalletClient` from the config chain and a private key. Timeout=30s, retryCount=2. **NOTE: zero active callers in the repo** (engine EVM signing uses `createDynamicWalletClient` from `@tools/khalani/evm-client.js` directly; `getSigningClient` may be a pre-Khalani legacy export retained for CLI/test use).
- `src/tools/wallet/client.ts:29` `getPublicClient()` — viem `PublicClient` for the config chain. RPC-URL-keyed cache. Timeout=10s, retryCount=2. **NOTE: zero callers in vex-agent or vex-app** (Khalani EVM balance reads use `createDynamicPublicClient`; may be CLI/test only).
- `src/tools/wallet/client.ts:55` `clearClientCache()` — invalidates the module-level client cache.

### Legacy create/import (single wallet, fixed keystore)

- `src/tools/wallet/create.ts:21` `createWallet({force?})` — EVM wallet creation to `KEYSTORE_FILE`. Backup if `force+exists`. `generatePrivateKey` → `encryptPrivateKey(requireKeystorePassword())` → `saveKeystore` → `registerPrimaryLegacyWallet("evm", address)`.
- `src/tools/wallet/import.ts:21` `importWallet(rawKey, {force?})` — EVM wallet import to `KEYSTORE_FILE`. Same pattern, `normalizePrivateKey` first.
- `src/tools/wallet/solana-create.ts:13` `createSolanaWallet({force?})` — Solana wallet creation to `SOLANA_KEYSTORE_FILE`. `Keypair.generate()` → `encryptSolanaSecretKey` → `saveSolanaKeystore` → `registerPrimaryLegacyWallet("solana", address)`.
- `src/tools/wallet/solana-import.ts:18` `importSolanaWallet(rawKey, {force?})` — Solana wallet import to `SOLANA_KEYSTORE_FILE`. `normalizeSolanaSecretKey` first.

### Utilities

- `src/tools/wallet/family.ts:3` `WalletChain = "eip155" | "solana"` — chain type alias. `normalizeWalletChain` accepts `"eip155"|"evm"` → `"eip155"`, `"solana"|"sol"` → `"solana"`.
- `src/tools/wallet/native-balances.ts:110` `collectNativeBalances(address, family, chains, opts)` — native balance fetch across Khalani chains (EVM via `createDynamicPublicClient`; Solana via `@solana/web3.js Connection`). Returns `NativeBalanceResult[]` with per-chain error field (non-throwing).

## Key types & invariants

- `KeystoreV1` (`src/tools/wallet/keystore.ts:10`) — version field enables future format migration; `decryptSecretBytes` hard-checks `version === 1`.
- `KDF_PARAMS.N = 2^14 = 16384` (`src/tools/wallet/keystore.ts:27`) — **SECURITY NOTE (Z5, flagged in Structure.md F10)**: keystore scrypt cost is materially weaker than the vault (`lib/local-secret-vault.ts` uses N=65536). The factor-4 gap means offline brute-force of a stolen keystore file is 4x faster than offline brute-force of a stolen vault file. Both protect the same master password. This is a documented asymmetry, not an accidental omission. Relevant file:line: `src/tools/wallet/keystore.ts:27 KDF_PARAMS`.
- `isValidWalletId` (`src/config/store.ts:36`) — **path-traversal guard**: enforces `<family-prefix>_<uuid>` for non-legacy ids. A crafted id containing `/`, `\`, `..` cannot produce a path outside `CONFIG_DIR` because the UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` rejects those characters. Checked at both config-load time (drops invalid rows) and `derivePath` call site (throws before building any path).
- `WalletResolution` (`src/tools/wallet/multi-auth.ts:82`) — discriminated union load-bearing for session isolation. `source:"session"` with `evm:null` DOES NOT fall through to the primary wallet. The engine always uses `source:"session"` (enforced by `buildSessionWalletResolution` in `hydrate.ts`). `source:"default"` is only for trusted, non-session-scoped callers.
- **Fail-closed on address drift**: `resolveSelectedEntry` checks `walletAddressesEqual(inv, entry.address, selected.address)`. If a user force-re-imports a key under the same wallet id, the new key's address would differ from the session-pinned snapshot, triggering `WALLET_SCOPE_MISMATCH` (not a silent upgrade). This is the load-bearing invariant for per-session wallet isolation.
- `loadEvmKey` address verification (`src/tools/wallet/inventory.ts:157`) — after decryption, asserts `privateKeyToAddress(pk) === getAddress(entry.address)`. Throws `SIGNER_MISMATCH` before returning. Prevents signing with a mismatched key due to corrupt or misrouted keystore files.
- `decryptExportSecret` Solana zeroization (`src/tools/wallet/inventory.ts:179`) — Solana path wraps `encodeSolanaSecretKey` in a `try/finally` that calls `secretKey.fill(0)`. The plaintext buffer is zeroed even on address-mismatch throw. EVM path returns a JS string (immutable — cannot be zeroed; noted in `wallet-export.ts:309`).
- `assertCanAddWallet` cap (`src/tools/wallet/inventory.ts:231`) — hard limit of 3 wallets per family. Enforced at `appendWalletEntry`, not config-load (so existing installs with more wallets are not broken by a load, only blocked from adding more).
- `appendWalletEntry` label length guard (`src/tools/wallet/inventory-create.ts:57`) — rejects labels >120 chars BEFORE any write. The config normalizer silently drops entries with >120-char labels on re-load (Zod schema cap: `z.string().max(120)`), so persisting one would cause silent data loss on next load.

## Capabilities (stable IDs)

- **CAP-wallet-keystore-encrypt**: AES-256-GCM + scrypt encryption of EVM or Solana secret bytes — `src/tools/wallet/keystore.ts:58 encryptSecretBytes`
- **CAP-wallet-keystore-decrypt**: Authenticated decryption; wrong-password / corrupt throws `KEYSTORE_DECRYPT_FAILED` — `src/tools/wallet/keystore.ts:88 decryptSecretBytes`
- **CAP-wallet-keystore-save**: Atomic filesystem write of KeystoreV1, `chmod 0o600` — `src/tools/wallet/keystore.ts:124 saveKeystoreFile`
- **CAP-wallet-keystore-load**: Load and structurally validate KeystoreV1 from path — `src/tools/wallet/keystore.ts:177 loadKeystoreFile`
- **CAP-wallet-id-validate**: Path-traversal guard + family-binding wallet id validation — `src/config/store.ts:36 isValidWalletId`
- **CAP-wallet-path-derive**: Traversal-guarded keystore path derivation from inventory entry — `src/tools/wallet/inventory.ts:102 derivePath`
- **CAP-wallet-load-evm-key**: Decrypt EVM key + address verification; fail-closed on SIGNER_MISMATCH — `src/tools/wallet/inventory.ts:157 loadEvmKey`
- **CAP-wallet-export-secret**: Sudo-export with caller-supplied password + address verify + Solana buffer zeroization — `src/tools/wallet/inventory.ts:179 decryptExportSecret`
- **CAP-wallet-inventory-read**: Config-side read access (list, getById, getPrimary*) — `src/tools/wallet/inventory.ts:60 listWallets` + siblings
- **CAP-wallet-inventory-add**: Cap+duplicate check + non-legacy wallet entry creation — `src/tools/wallet/inventory-create.ts:48 appendWalletEntry`
- **CAP-wallet-inventory-export-bundle**: Copy encrypted keystores + sanitized manifest to destDir (no config secrets) — `src/tools/wallet/inventory-create.ts:137 exportAllWallets`
- **CAP-wallet-resolve-entry**: Session-scoped address-only resolution with snapshot pinning; fail-closed on drift — `src/tools/wallet/multi-auth.ts:106 resolveSelectedEntry`
- **CAP-wallet-resolve-signer**: Resolve + decrypt ChainWallet for a family; session-scoped; fail-closed — `src/tools/wallet/multi-auth.ts:163 resolveWalletForFamily`
- **CAP-wallet-resolution-build**: Map hydrated session selection → WalletResolution (always source:"session") — `src/vex-agent/engine/core/hydrate.ts:72 buildSessionWalletResolution`
- **CAP-wallet-backup-create**: Timestamped backup of keystore(s) + config with manifest — `src/tools/wallet/backup.ts:43 autoBackup`
- **CAP-wallet-legacy-create-evm**: EVM wallet generation to fixed KEYSTORE_FILE + register legacy entry — `src/tools/wallet/create.ts:21 createWallet`
- **CAP-wallet-legacy-import-evm**: EVM wallet import to fixed KEYSTORE_FILE + register legacy entry — `src/tools/wallet/import.ts:21 importWallet`
- **CAP-wallet-legacy-create-solana**: Solana wallet generation to fixed SOLANA_KEYSTORE_FILE — `src/tools/wallet/solana-create.ts:13 createSolanaWallet`
- **CAP-wallet-legacy-import-solana**: Solana wallet import to fixed SOLANA_KEYSTORE_FILE — `src/tools/wallet/solana-import.ts:18 importSolanaWallet`
- **CAP-wallet-public-client**: viem PublicClient factory for config chain (cached, RPC-URL keyed) — `src/tools/wallet/client.ts:29 getPublicClient`
- **CAP-wallet-signing-client**: viem WalletClient factory from private key + config chain — `src/tools/wallet/signingClient.ts:6 getSigningClient` (**no active callers**)

## Public API (consumed by)

| Consumer | Entry | What it uses |
|---|---|---|
| `vex-app/src/main/ipc/wallet-export.ts:43` | `decryptExportSecret`, `getWalletById` via `@vex-lib/wallet.js` | Sudo private-key export to clipboard |
| `vex-app/src/main/ipc/onboarding/wallets.ts` | `createEvmWalletEntry`, `importEvmWalletEntry`, `createSolanaWalletEntry`, etc. via `@vex-lib/wallet.js` | Onboarding wizard wallet creation/import |
| `vex-app/src/main/onboarding/wallets-runner.ts` | wallet primitives via `@vex-lib/wallet.js` | Wizard wallet management |
| `vex-app/src/main/onboarding/wallet-restore.ts` | wallet primitives via `@vex-lib/wallet.js` | Wallet restore flow |
| `vex-app/src/main/onboarding/finalize.ts` | `autoBackup` via `@vex-lib/wallet-backup.js` | Post-onboarding backup |
| `vex-app/src/main/ipc/wallets-session.ts` | inventory reads via `@vex-lib/wallet.js` | Session wallet scope IPC |
| `vex-app/src/main/ipc/_wallet-refs.ts` | shared wallet reference helpers via `@vex-lib/wallet.js` | IPC shared references |
| `vex-app/src/main/secrets/session.ts` | vault unlock / config load via `@vex-lib/wallet.js` | Sets `VEX_KEYSTORE_PASSWORD` post-unlock |
| `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` | wallet primitives via `@vex-lib/wallet.js` | Polymarket EIP-712 credential derivation |
| `src/vex-agent/engine/core/hydrate.ts:11` | `WalletResolution` type, `buildSessionWalletResolution` | Builds session-scoped resolution on hydrate |
| `src/vex-agent/engine/core/run-tool.ts` | `buildSessionWalletResolution`, `resolveWalletPolicy` | Threads wallet context into tool dispatch |
| `src/vex-agent/engine/core/turn-loop-tool-batch.ts` | `buildSessionWalletResolution` | Threads wallet context per turn |
| `src/vex-agent/engine/core/approval-runtime/post-tx.ts` | `WalletResolution`, `buildSessionWalletResolution` | Re-threads wallet resolution for approved dispatch |
| `src/vex-agent/engine/prompts/wallet-state.ts` | `buildSessionWalletResolution`, `resolveSelectedAddressSet` | Wallet banner in system prompt |
| `src/vex-agent/tools/internal/wallet/resolve.ts` | `resolveSelectedEntry`, `loadWalletFromEntry`, `WalletResolution` | engine-side address-only + signing resolution |
| `src/vex-agent/tools/internal/types.ts:22` | `WalletResolution` type | `InternalToolContext.walletResolution` field |
| `src/vex-agent/tools/protocols/types.ts` | `WalletResolution` type | Protocol tool context |
| `src/vex-agent/tools/protocols/khalani/handlers/read.ts` | wallet primitives | Khalani balance reads |
| `src/vex-agent/tools/protocols/kyberswap/handlers/*.ts` | wallet primitives | Kyberswap swap/zap/limit-order |
| `src/vex-agent/tools/protocols/solana-jupiter/handlers/core.ts` | wallet primitives | Jupiter swap execution |
| `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts` | wallet primitives | Polymarket CLOB signing |
| `src/vex-agent/sync/balance-sync.ts` | wallet primitives | Background balance sync |

## Internal flow

### Session wallet resolution (engine signing path — per tool call)

```
hydrate.ts: buildSessionWalletResolution(session)
  → WalletResolution {source:"session", evm:{id,address}|null, solana:{id,address}|null}
  (threaded into InternalToolContext.walletResolution)

tools/internal/wallet/resolve.ts: resolveSigningWallet(resolution, policy, network)
  → resolveSelectedEntry(family, resolution)       ← address only, no decrypt
      session.evm/solana null → WALLET_NOT_SELECTED (fail-closed)
      getWalletById(id) null → WALLET_SCOPE_MISMATCH
      walletAddressesEqual(recorded, snapshot) false → WALLET_SCOPE_MISMATCH (drift)
      → {family: InventoryFamily, entry: WalletInventoryEntry}
  [policy checks]
  → loadWalletFromEntry(family, entry)
      evm → loadEvmWalletFromEntry(entry)
            loadEvmKey(entry)
              loadEvmSecret(entry) = loadKeystoreFile(derivePath(family,entry))
              → decryptPrivateKey(keystore, requireKeystorePassword())
              address verify: privateKeyToAddress(pk) === getAddress(entry.address)
              → {address, privateKey}
            → EvmWallet {family:"eip155", address, privateKey}
      solana → loadSolanaWalletFromEntry(entry)
               loadSolanaSecret(entry) → decryptSolanaSecretKey(keystore, requireKeystorePassword())
               address verify: deriveSolanaAddress(sk) === entry.address
               → SolanaWallet {family:"solana", address, secretKey}
  → ChainWallet
```

### Sudo private-key export (vex-app IPC path)

```
vex-app/src/main/ipc/wallet-export.ts: registerWalletExportHandler
  checkExportAllowed()          ← throttle gate (3 failures → 30s lockout)
  getSecretSessionStatus()      ← session must be unlocked
  verifySecretVaultPassword(input.password)  ← sudo re-auth (vault only)
  getWalletById(input.chain, input.walletId) ← fail-closed on unknown id
  decryptExportSecret({family, entry, password:input.password})
    derivePath(family, entry)   ← traversal guard via isValidWalletId
    loadKeystoreFile(path)      ← throws KEYSTORE_NOT_FOUND if missing
    decryptPrivateKey(ks, password) / decryptSolanaSecretKey(ks, password)
    address verify              ← throws SIGNER_MISMATCH on mismatch
    [Solana: secretKey.fill(0) in finally]
    → {secret, format}
  acquireLease(secret)          ← clipboard write + auto-clear timer (SHA-256 compare)
  secret = ""                   ← drop reference
  audit log: chain + walletId + correlationId only, never the secret
```

### Wallet creation (onboarding non-legacy path)

```
vex-app/src/main/ipc/onboarding/wallets.ts: createEvmWalletEntry({label?})
  requireKeystorePassword()     ← VEX_KEYSTORE_PASSWORD must be set
  generatePrivateKey()          ← viem random
  privateKeyToAddress(pk)
  encryptPrivateKey(pk, password) → KeystoreV1 (N=16384)
  appendWalletEntry("evm", address, keystore, label)
    assertCanAddWallet           ← cap=3, no duplicate address
    generateWalletId("evm")      ← "evm_<uuid>"
    saveKeystoreFile(derivePath(family, entry), keystore)
    saveConfig(cfg with new entry appended)
    → WalletInventoryEntry (no key material)
```

## Dependencies

**Imports FROM:**
- `src/config/paths.ts` — `CONFIG_DIR`, `KEYSTORE_FILE`, `SOLANA_KEYSTORE_FILE`, `BACKUPS_DIR`, `CONFIG_FILE`
- `src/errors.ts` — `VexError`, `ErrorCodes`
- `src/utils/env.ts` — `requireKeystorePassword` (reads `VEX_KEYSTORE_PASSWORD`)
- `src/utils/logger-shim.ts` — `minLogger` (no winston pull in crypto paths)
- `src/lib/secret-keys.ts` — `MASTER_PASSWORD_ENV_KEY` (constant only)
- `viem`, `viem/accounts` — EVM key/address primitives
- `@solana/web3.js` — Solana keypair + public key derivation
- `bs58` — Solana secret key encoding
- `node:crypto`, `node:fs`, `node:path`, `node:url` — stdlib

**Consumed BY:**
- Z5 itself (facade: `src/lib/wallet.ts` re-exports all primitives)
- Z6 (`vex-app/src/main/**`) via `@vex-lib/wallet.js` — all wallet IPC handlers, onboarding, secrets session, export
- Z3 (`src/vex-agent/tools/internal/wallet/resolve.ts`) — engine signing path
- Z3 (`src/vex-agent/tools/protocols/**`) — Khalani, Kyberswap, Jupiter, Polymarket protocol handlers
- Z1 (`src/vex-agent/engine/core/hydrate.ts`, `run-tool.ts`, `turn-loop-tool-batch.ts`, `approval-runtime/post-tx.ts`) — `WalletResolution` type + `buildSessionWalletResolution`
- Z2 (`src/vex-agent/engine/prompts/wallet-state.ts`) — wallet banner

## Cross-references

- related decisions: `decisions/ADR-0001-global-model-session-wallet` (per-session wallet selection invariant; selection immutable post-creation; EVM + Solana columns in `sessions` via mig 026)
- related module: `module.src-root.lib-vault-secrets` (vault uses N=65536; keystore uses N=16384 — documented asymmetry)
- related module: `module.vex-agent.tools-internal` (wallet tool handlers — `CAP-tools-wallet-resolve-address`, `CAP-tools-wallet-resolve-signer`, `CAP-tools-wallet-confirm`)
- quality finding: Structure.md F10 — KDF asymmetry keystore N=16384 < vault N=65536 (`src/tools/wallet/keystore.ts:27 KDF_PARAMS`)
- vex-app coverage: `audits/current/coverage-gaps.md#CAP-wallet-export-secret`

## Refresh triggers

Stale when any of the following change:
- `src/tools/wallet/**` — any keystore, inventory, multi-auth, client file
- `src/lib/wallet.ts` or `src/lib/wallet-backup.ts` — facade exports
- `src/config/store.ts` — VexConfig shape, isValidWalletId, normalizeWalletSection
- `src/config/paths.ts` — CONFIG_DIR resolver
- `src/utils/env.ts` or `src/lib/secret-keys.ts` — password env key or accessor
- `src/vex-agent/engine/core/hydrate.ts` — buildSessionWalletResolution, resolveWalletPolicy

## Open questions

1. **`getSigningClient` dead code**: `src/tools/wallet/signingClient.ts` has zero callers in vex-agent or vex-app. The engine uses `createDynamicWalletClient` from Khalani for EVM signing. Confirm whether this export is retained for CLI tooling, tests, or can be removed. Removing would simplify the config-chain-bound signing surface.

2. **`getPublicClient` dead code**: `src/tools/wallet/client.ts:getPublicClient` similarly has no callers in vex-agent or vex-app main. The module-level cache (by RPC URL) is stateful and would not be cleared across config changes unless `clearClientCache()` is called. If retained, confirm ownership of cache lifecycle.

3. **KDF asymmetry (reaffirm)**: Keystore scrypt N=16384 (`keystore.ts:27`) vs vault N=65536. Both protect the same master password. An attacker who steals only `keystore.json` (without `secrets.vault.json`) faces 4x less compute to brute-force. This is the documented Z5/F10 finding. A future hardening pass could upgrade keystores to N=65536 with a re-encrypt step on first unlock.

4. **EVM string secret in export**: `decryptExportSecret` for EVM returns a JS `string` (immutable; cannot be zeroed). The `wallet-export.ts` handler notes this at line 309 and clears the reference immediately. Solana plaintext is zeroized via `finally`. Evaluate whether a `Uint8Array` path for EVM (returning hex bytes, not a string) would reduce exposure window.

5. **`autoBackup` scope**: Only backs up `keystore.json`, `solana-keystore.json`, and `config.json`. Does NOT back up per-id `wallet-<id>.json` files created by the non-legacy inventory paths. Users with multiple wallets created after onboarding could lose the additional keystores in a backup-restore scenario. Confirm whether `autoBackup` should iterate `CONFIG_DIR/wallet-*.json` files.

6. **`normalizeWalletSection` silent drop**: Malformed or non-canonical inventory rows are dropped with a `logger.warn` (not thrown). This means a corrupt config row is silently invisible after the next `saveConfig`. Consider whether a UI-visible warning or a `bug_reports` row should surface this condition.
