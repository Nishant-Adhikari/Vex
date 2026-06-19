### 2.4 Work Unit 4 — Secrets, vault, wallet export

#### Files & LOC

- `vex-app/src/main/secrets/session.ts` 296 LOC
- `vex-app/src/main/ipc/secrets.ts` 110 LOC
- `vex-app/src/main/ipc/wallet-export.ts` 335 LOC — **god-file/refactor candidate**
- `src/lib/local-secret-vault.ts` 351 LOC — **god-file/refactor candidate**
- `src/lib/secret-keys.ts` 30 LOC
- `src/tools/wallet/keystore.ts` 213 LOC
- `src/tools/wallet/solana-keystore.ts` 96 LOC
- `src/tools/wallet/inventory.ts` 271 LOC
- `src/tools/wallet/multi-auth.ts` 169 LOC
- `src/tools/wallet/backup-restore.ts` 722 LOC — **god-file/refactor candidate**
- `src/tools/wallet/backup.ts` 421 LOC — **god-file/refactor candidate**
- `src/tools/wallet/polymarket-credentials.ts` 412 LOC — **god-file/refactor candidate**

#### Responsibility

- `session.ts`: main-process unlocked secret session, env injection, lock/scrub behavior.
- `local-secret-vault.ts`: encrypted vault persistence and `.env` stripping for managed secrets.
- `secret-keys.ts`: central managed secret key names.
- `wallet-export.ts`: private key export through reauth and clipboard lease.
- `keystore.ts` / `solana-keystore.ts`: encrypted wallet key storage.
- `inventory.ts` / `multi-auth.ts`: wallet identity and selection validation.
- `backup*`: wallet backup/restore.
- `polymarket-credentials.ts`: derive/store CLOB credentials from selected wallet.

#### Mechanisms/patterns

- AES-256-GCM encryption.
- scrypt KDF.
- Atomic writes and restrictive POSIX mode where applicable.
- Managed secret stripping from `.env`.
- Main memory only for unlocked master password.
- `process.env` injection for runtime config.
- Provider registry reset on lock.
- Wallet export writes key only to clipboard and returns metadata.
- Clipboard lease auto-clears by content hash.
- Wallet inventory verifies decrypted key derives configured address.

#### Dependencies & data-flow

Entry points:

- Renderer unlock/setup/export UI calls main IPC.
- Main secrets session decrypts vault and sets process env.
- Agent runtime reads secrets through env/provider config.
- Wallet export handler loads/decrypts wallet after reauth.

Imports/dependencies:

- Main IPC imports secrets/session and wallet helpers.
- Protocol credential setup imports wallet decrypt helpers only in setup paths.
- Protocol auth uses stored credentials, not keystore primitives.

Side effects:

- Vault file writes.
- `.env` rewrite/secret stripping.
- Wallet keystore writes.
- Clipboard writes and timer-based cleanup.
- `process.env` mutation and scrubbing.
- Optional GC hint after lock.

#### Security surface

- Vault master password must not leave main process.
- Managed API keys must not enter renderer state/localStorage/logs.
- Wallet private key export must never return key over IPC.
- Polymarket credential map is address scoped and encrypted.
- JS strings cannot be zeroized; minimize scope and lifetime.

#### Hotspots

- `local-secret-vault.ts` 351 LOC is central security code.
- `wallet-export.ts` 335 LOC is security-critical.
- `backup-restore.ts` 722 LOC and `backup.ts` 421 LOC concentrate wallet backup authority.
- `polymarket-credentials.ts` 412 LOC mixes wallet decrypt and credential persistence.
- `session.ts` injects secrets into `process.env`; downstream log/support code must exclude env dumps.
- `electron-secret-adapter.ts` stores Postgres password plaintext; related but handled in local-services unit.

`console.*` density:

- No specific high-density console cluster identified here. Any logging around secrets must use redacted loggers only.

#### Tests

Covered:

- `vex-app/src/main/ipc/__tests__/secrets.test.ts`
- `vex-app/src/main/ipc/__tests__/wallet-export.test.ts` 881 LOC
- Wallet keystore/inventory/backup/multi-auth tests under `src/__tests__/**`
- Polymarket credential tests under wallet/protocol tests.

Not covered / unclear:

- JS string lifetime/DOM password retention policy across renderer forms.
- Complete support-bundle/env exclusion proof.
- Clipboard behavior across OSes.
- Backup restore destructive/overwrite edge cases.

#### Open risks/smells

- Decide explicit secret-state policy for renderer password fields.
- Ensure no future support bundle includes env, vault path, keystore path, or DB URL.
- Split wallet backup/restore after test behavior is pinned.
- Treat all new wallet setup/export changes as critical security changes.

