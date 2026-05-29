---
id: module.vex-app.main-secrets-wallet-support
kind: module
domain: vex-app
source_commit: 1c858ee
indexed_at: 2026-05-29
paths:
  - vex-app/src/main/secrets/**
  - vex-app/src/main/wallet/**
  - vex-app/src/main/ipc/secrets.ts
  - vex-app/src/main/ipc/wallet-export.ts
  - vex-app/src/main/ipc/wallet-export-clipboard-lease.ts
  - vex-app/src/main/ipc/wallets-session.ts
  - vex-app/src/main/ipc/_wallet-refs.ts
  - vex-app/src/main/ipc/telemetry.ts
  - vex-app/src/main/ipc/support.ts
  - vex-app/src/main/telemetry/**
  - vex-app/src/main/support/**
  - vex-app/src/main/security/**
  - vex-app/src/main/logger/**
stale_when_paths_change:
  - vex-app/src/main/secrets/**
  - vex-app/src/main/wallet/**
  - vex-app/src/main/ipc/secrets.ts
  - vex-app/src/main/ipc/wallet-export.ts
  - vex-app/src/main/ipc/wallet-export-clipboard-lease.ts
  - vex-app/src/main/ipc/wallets-session.ts
  - vex-app/src/main/ipc/telemetry.ts
  - vex-app/src/main/support/**
  - vex-app/src/main/telemetry/**
  - src/lib/local-secret-vault.ts
  - src/lib/secret-keys.ts
  - src/tools/wallet/keystore.ts
related:
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-ipc-engine-orchestration
  - module.src-root.lib-vault-secrets
  - module.src-root.lib-wallet
  - module.src-root.lib-diagnostics
  - fix-plan.F1
  - ADR-0001-global-model-session-wallet
  - audit.current.security-review
---

# Vex Electron Main Process — Secrets, Wallet Export, Telemetry, and Support

## Purpose

This module owns the main process surface for end-user secrets (master password + vault encryption), wallet private-key export with clipboard auto-clear, telemetry consent and Sentry integration, and support/bug-report collection — all of which are untrusted from the renderer perspective.

The vault is the single encryption boundary: `AES-256-GCM + scrypt N=131072` (2^17, OWASP). The master password is held in memory only; locking clears it from the in-process reference but intentionally **does not** clear vault-injected API keys from `process.env` (FINDING-security-003). Wallet export requires re-authentication (sudo-style) and routes the plaintext secret through a clipboard lease with a 10-second auto-clear TTL.

Telemetry is opt-in (default OFF) using Sentry when DSN is resolvable; Sentry is never loaded until user consent flips on. Support bundles use redaction guards to strip secrets before local persistence.

## Retrieval Keywords

- unlock, lock, master password
- vault inject, scrypt N=131072 (2^17, vault+keystore parity)
- OPENROUTER_API_KEY, env injection, provider config
- wallet export, private key export, clipboard lease
- throttle, unlock-throttle, export-throttle
- telemetry consent, Sentry, beforeSend, beforeBreadcrumb
- support bundle, bug report, redaction
- session wallet, per-session, wallet scope
- clipboard clear, TTL, SHA-256 hash
- process.env, lockSecretSession
- disabled-by-default, opt-in consent

## State Owned

**In-memory:**
- `unlockedMasterPassword: string | null` (primary secret cache in `secrets/session.ts:27`)
- `failedAttempts` counters in unlock-throttle and export-throttle
- Single active clipboard lease with monotonic token + secret hash (SHA-256)
- Sentry initialization flag + lifecycle chain

**On-disk (encrypted):**
- `SECRETS_VAULT_FILE` — AES-256-GCM vault containing `OPENROUTER_API_KEY`, Polymarket credentials, etc.

**Consent/configuration (persistent):**
- `preferencesStore` — telemetry consent (`enabled: boolean`), upload consent (Phase 3)

## Boundary Crossings

**IPC contracts (all Zod-validated):**

| Channel | Input | Output | Security Rules |
|---------|-------|--------|-----------------|
| `CH.secrets.status` | `{}` | `{ vaultConfigured, unlocked }` | Read-only status; no secret leakage |
| `CH.secrets.unlock` | `{ password: string }` | `{ unlocked: true }` | Throttled; wrong-password advances counter; locks at 5 failures (unlock) |
| `CH.secrets.lock` | `{}` | `{ locked: true }` | Explicit session relock; renderer-initiated |
| `CH.wallet.exportPrivateKey` | `{ chain, walletId, password }` | `{ chain, format, copied, clearAfterMs }` | Throttled (5-fail lockout); session must be unlocked first; secret never returned; clipboard only |
| `CH.wallets.listAvailable` | `{}` | `{ evm: [...], solana: [...] }` | Addresses public; keys never included |
| `CH.wallets.listSessionWallets` | `{ sessionId }` | `{ evm/solana refs }` | Per-session scope from DB; CAS-protected |
| `CH.wallets.setSessionWalletScope` | `{ sessionId, evmWalletId, solanaWalletId }` | `{ status, message }` | Renderer sends IDs only; main resolves addresses; invalid ID → fail closed |
| `CH.wallets.getPreparedIntent` | `{ intentId, sessionId }` | `{ PreparedIntentDto \| null }` | Projection only: `failure_reason`, `idempotencyKey` filtered out |
| `CH.wallets.cancelPreparedIntent` | `{ intentId, sessionId }` | `{ status: "cancelled" \| "already_terminal" }` | CAS-protected; cross-session IDs collapse to `already_terminal` |
| `CH.telemetry.reportRendererError` | `{ kind, message, componentStack? }` | `{ recorded: boolean }` | No consent → silent ok; consent + Sentry init → forward; redaction runs in `beforeSend` |
| `CH.support.createBugReport` | `{ title, description, context, refs, ... }` | `{ reportId, recorded, uploadState }` | Redaction applies to title/description/context/refs; no consent gate (local data) |

**Main reads/writes filesystem:**
- Vault file (`SECRETS_VAULT_FILE`): read/write encrypted content
- `.env` file: read on boot, stripped of managed secrets post-unlock
- Bug reports DB: local persistence (queries through `bug-reports-db` layer)
- Sentry offline queue (`userData/sentry`): deleted on consent revoke
- Install ID file: read-only

**Never exposes to renderer:**
- Master password
- Unencrypted vault contents
- Private keys (clipboard only, auto-cleared)
- Sentry events or raw error fields (only confirmed-recorded boolean)
- Internal provider state or API-key names

**Clipboard safety:**
- Plaintext secret written to OS clipboard via `clipboard.writeText(secret)`
- SHA-256 hash stored; plaintext never held in `ClipboardLease` struct
- Timer fires after 10s; checks hash before clearing to tolerate user overwrites
- App-quit cleanup registry runs idempotent clear if still active
- Token monotonicity prevents race between lease replacement and timer/cleanup

## File Map

| Path | Line | Symbol / Responsibility |
|------|------|--------------------------|
| `vex-app/src/main/secrets/session.ts` | 27 | `let unlockedMasterPassword: string \| null` — in-memory master password ref |
| `vex-app/src/main/secrets/session.ts` | 79–84 | `getSecretSessionStatus()` — public status query |
| `vex-app/src/main/secrets/session.ts` | 86–99 | `initializeMasterPassword()` — onboarding setup |
| `vex-app/src/main/secrets/session.ts` | 101–113 | `unlockSecretSession()` — unlock entry point; calls `applySecretVaultToProcessEnv()` |
| `vex-app/src/main/secrets/session.ts` | 121–127 | `lockSecretSession()` — in-process scrub of master password ref only |
| `vex-app/src/main/secrets/session.ts` | 129–139 | `requireUnlockedMasterPassword()` — guard for operations requiring unlock |
| `vex-app/src/main/secrets/session.ts` | 141–157 | `writeUnlockedSecrets()` — vault write (e.g., OPENROUTER_API_KEY) |
| `vex-app/src/main/secrets/session.ts` | 159–179 | `getUnlockedSecretPresence()` — secret-key presence probe (no values) |
| `vex-app/src/main/secrets/session.ts` | 181–233 | `getConfiguredPolymarketAddresses()` — wallet-picker badge logic |
| `vex-app/src/main/secrets/unlock-throttle.ts` | 18–25 | `BACKOFF_MS` — exponential backoff: 1s→2s→4s→8s→30s→5min |
| `vex-app/src/main/secrets/unlock-throttle.ts` | 45–49 | `checkUnlockAllowed()` — gate snapshot (no mutation) |
| `vex-app/src/main/secrets/unlock-throttle.ts` | 56–60 | `recordUnlockFailure()` — advance counter on wrong password |
| `vex-app/src/main/secrets/unlock-throttle.ts` | 66–69 | `recordUnlockSuccess()` — reset on successful unlock |
| `vex-app/src/main/ipc/secrets.ts` | 36–107 | `registerSecretsHandlers()` — three IPC handlers: status, unlock, lock |
| `vex-app/src/main/ipc/secrets.ts` | 51–91 | Unlock handler with throttle gate + wrong-password counter |
| `vex-app/src/main/ipc/secrets.ts` | 98–104 | Lock handler — explicit relock trigger |
| `vex-app/src/main/wallet/export-throttle.ts` | 22 | `EXPORT_FAIL_LIMIT = 5` — relock after 5 consecutive failures |
| `vex-app/src/main/wallet/export-throttle.ts` | 29–35 | `BACKOFF_MS` — shorter plateau: 1s→2s→4s→8s→30s (no 5-min) |
| `vex-app/src/main/wallet/export-throttle.ts` | 61–69 | `checkExportAllowed()` — gate + lockout flag |
| `vex-app/src/main/wallet/export-throttle.ts` | 81–86 | `recordExportFailure()` — advance + signal relocking |
| `vex-app/src/main/ipc/wallet-export.ts` | 1–41 | Flow documentation: throttle, re-auth, resolve, decrypt, clipboard, audit |
| `vex-app/src/main/ipc/wallet-export.ts` | 127–327 | `registerWalletExportHandler()` — end-to-end export orchestrator |
| `vex-app/src/main/ipc/wallet-export.ts` | 136–156 | Step 1: throttle gate |
| `vex-app/src/main/ipc/wallet-export.ts` | 158–174 | Step 2: session unlock check (renderer gate assumed) |
| `vex-app/src/main/ipc/wallet-export.ts` | 176–257 | Step 3: sudo-style re-auth via `verifySecretVaultPassword()` |
| `vex-app/src/main/ipc/wallet-export.ts` | 259–268 | Step 4: wallet ID resolution fail-closed |
| `vex-app/src/main/ipc/wallet-export.ts` | 270–302 | Step 5: `decryptExportSecret()` + verify address match |
| `vex-app/src/main/ipc/wallet-export.ts` | 304–324 | Step 6–8: clipboard lease + audit log |
| `vex-app/src/main/ipc/wallet-export-clipboard-lease.ts` | 18–25 | `CLEAR_AFTER_MS = 10_000` — TTL spec-locked |
| `vex-app/src/main/ipc/wallet-export-clipboard-lease.ts` | 27–45 | `interface ClipboardLease` — token + secretHash + timer + unregister |
| `vex-app/src/main/ipc/wallet-export-clipboard-lease.ts` | 50–73 | `hashSecret()`, `clearIfStillOurs()` — SHA-256 check before clear |
| `vex-app/src/main/ipc/wallet-export-clipboard-lease.ts` | 90–142 | `acquireLease()` — replacement protocol: null ref BEFORE unregister |
| `vex-app/src/main/ipc/wallet-export-clipboard-lease.ts` | 118–130 | Timer callback: token check + conditional clear + unregister |
| `vex-app/src/main/ipc/wallet-export-clipboard-lease.ts` | 132–140 | Quit-cleanup callback: idempotent clear on active lease |
| `vex-app/src/main/ipc/_wallet-refs.ts` | 19–26 | `resolveWalletRef()` — ID→{id,address} resolution; null/"invalid" returns |
| `vex-app/src/main/ipc/_wallet-refs.ts` | 28–38 | `invalidWalletSelectionError()` — fail-closed VexError |
| `vex-app/src/main/ipc/wallets-session.ts` | 69–88 | `listAvailable()` — inventory addresses (no keys) |
| `vex-app/src/main/ipc/wallets-session.ts` | 90–118 | `listSessionWallets()` — per-session scope DTO from DB |
| `vex-app/src/main/ipc/wallets-session.ts` | 120–151 | `setSessionWalletScope()` — CAS init-if-empty + mission recompute |
| `vex-app/src/main/ipc/wallets-session.ts` | 181–216 | `getPreparedIntent()` — projection: drop `failure_reason`, `idempotencyKey` |
| `vex-app/src/main/ipc/wallets-session.ts` | 221–272 | `cancelPreparedIntent()` — CAS cancel; cross-session → `already_terminal` |
| `vex-app/src/main/ipc/telemetry.ts` | 37–56 | `registerTelemetryHandler()` — no consent → silent ok; consent → forward |
| `vex-app/src/main/ipc/telemetry.ts` | 43–52 | Handler checks `prefs.telemetry.enabled` BEFORE calling `captureRendererError()` |
| `vex-app/src/main/ipc/support.ts` | 42–69 | `registerSupportHandler()` — bug-report IPC entry point |
| `vex-app/src/main/support/bug-report-service.ts` | 82–185 | `createBugReport()` — redaction + DB insert + transport enqueue |
| `vex-app/src/main/support/bug-report-service.ts` | 97–102 | `redactBugPayload()` called on title/description/context/refs |
| `vex-app/src/main/support/bug-report-service.ts` | 110–163 | Insert payload construction with redacted fields + context pressure |
| `vex-app/src/main/telemetry/sentry-lifecycle.ts` | 72–114 | `initSentryIfConsented()` — dynamic import; never load until consent |
| `vex-app/src/main/telemetry/sentry-lifecycle.ts` | 86–105 | Sentry init config: default integrations off, breadcrumbs filtered |
| `vex-app/src/main/telemetry/sentry-lifecycle.ts` | 121–140 | `disableSentry()` — close + flush + delete offline queue |
| `vex-app/src/main/telemetry/sentry-lifecycle.ts` | 155–176 | `captureRendererError()` — forward to Sentry; message is sentinel "renderer.error" |
| `vex-app/src/main/telemetry/before-send.ts` | 80–100+ | `makeBeforeSendHook()` — redact + strip URL queries + filter breadcrumbs |
| `vex-app/src/main/telemetry/before-send.ts` | 25–29 | `ALLOWED_BREADCRUMB_CATEGORIES` — only "navigation", "vex.ipc", "vex.wizard" |
| `vex-app/src/main/telemetry/before-send.ts` | 44–53 | `scrubUrlsInString()` — remove URL query strings (secondary to redactor) |
| `vex-app/src/main/telemetry/before-send.ts` | 55–78 | `scrubBreadcrumbs()` — filter + drop message/data fields |

## Key Types & Invariants

### Master Password & Unlock

1. **Master password held in-memory only** (line 27 of `session.ts`).
   - Initialized via `initializeMasterPassword(password)` or `unlockSecretSession(password)`.
   - Passed to `applySecretVaultToProcessEnv(password, { filePath })` which decrypts the vault and injects keys to `process.env`.
   - Cleared (nulled) by `lockSecretSession()` — **master password ref only**.

2. **Lock does NOT clear vault-injected API keys from process.env** (FINDING-security-003).
   - After unlock, `process.env.OPENROUTER_API_KEY` is set.
   - After lock, master password is nulled but `process.env` keys remain.
   - This is intentional (verified Round 2): locking is UI-level, not cryptographic isolation.
   - Mitigation: `process.env` keys expire on app restart or Chromium sandbox boundary.

3. **Scrypt KDF N=131072 (2^17)** — vault AND keystore at parity, the OWASP scrypt minimum (FINDING-security-004 RESOLVED, F10-OWASP commit 1c858ee).
   - Both stores use the same OWASP-recommended cost; the earlier keystore-weaker-than-vault asymmetry is gone.
   - Confirmed from `src/lib/local-secret-vault.ts` and `src/tools/wallet/keystore.ts`.
   - Documented as open tracking item; no immediate change planned.

### Throttling

4. **Unlock throttle** (unlock-throttle.ts):
   - Exponential backoff: 1s, 2s, 4s, 8s, 30s, 300s (5 min).
   - Wrong-password failures advance counter; IO errors do NOT.
   - No automatic relock (time-based gate only).
   - State resets on app relaunch.

5. **Export throttle** (export-throttle.ts):
   - Shorter backoff: 1s, 2s, 4s, 8s, 30s (no 5-min plateau).
   - At 5th consecutive failure: `lockoutTriggered = true` + handler calls `lockSecretSession()`.
   - Wrong-password failures only; IO/keystore errors do NOT advance.
   - State resets on app relaunch.

### Wallet Export Flow

6. **Export is sudo-style re-authentication**.
   - Session must already be unlocked (`getSecretSessionStatus().unlocked`).
   - Export request requires re-typing the master password.
   - `verifySecretVaultPassword()` does NOT mutate vault or session state.
   - Wrong password triggers throttle + potential relock.
   - Successful verify (even if decrypt later fails) does NOT advance throttle.

7. **Plaintext secret never returned to renderer**.
   - Decryption happens inside `decryptExportSecret()`.
   - Plaintext held only in local `secret` variable (line 274 of wallet-export.ts).
   - Immediately nulled (line 309) after clipboard write.
   - JS strings immutable; no in-process zeroization possible.

8. **Clipboard lease** (wallet-export-clipboard-lease.ts):
   - Single global active lease; new export cancels prior lease.
   - Lease token is monotonic; each replaces the previous.
   - Replacement protocol: null `activeLease` BEFORE unregistering prior lease (order critical).
   - Timer fires 10s after write; checks SHA-256 of current clipboard content before clearing.
   - App-quit cleanup registry runs idempotent clear if lease still active.
   - If user copies something else over the secret, conditional clear is a no-op (intentional).

### Wallet Session Scope (ADR-0001)

9. **Per-session wallet selection** (wallets-session.ts, migration 026).
   - Each session picks EVM wallet + Solana wallet at creation.
   - Selection immutable post-creation.
   - Renderer sends wallet IDs only; main resolves to {id, address} via `getWalletById()`.
   - Invalid ID → fail closed, no write.
   - CAS-protected on `sessions` row; init-if-empty only.

10. **Prepared intent projection** (wallets-session.ts, lines 155–179).
    - `failure_reason` and `idempotencyKey` intentionally filtered from DTO.
    - Defense-in-depth: renderer does not need structural hashes or engine internals.
    - Only allow-listed fields cross the IPC boundary.

### Telemetry & Consent

11. **Sentry is disabled-by-default** (sentry-lifecycle.ts).
    - Never loads `@sentry/electron` until `initSentryIfConsented()` called.
    - Checks `prefs.telemetry.enabled` before loading.
    - Dynamic import ensures module is not loaded pre-consent.

12. **beforeSend hook redaction** (before-send.ts).
    - Reuses production redactor (same as `main/logger/redact.ts`).
    - Strips URL query strings (secondary pass after redactor).
    - Filters breadcrumbs to allowlist: "navigation", "vex.ipc", "vex.wizard" only.
    - Drops breadcrumb message/data fields (only timestamp + category + type survive).

13. **Renderer error forwarding** (telemetry.ts).
    - Message field is NOT the raw error text.
    - Sentinel value "renderer.error" used as message.
    - Raw message + component stack stored in `event.extra.*` for redaction.
    - No consent → silent `ok({recorded: false})`.
    - Consent + SDK not initialized → still `ok({recorded: false})`.

### Bug Reports & Support

14. **Bug reports are local-first** (bug-report-service.ts).
    - No consent gate (local user data on their disk).
    - Redaction applied at service layer (lines 97–102).
    - Title, description, context, refs all redacted.
    - Renderer-supplied `refs.*` fields (sessionId, toolCallId, etc.) also redacted as untrusted.
    - Proof counts stamped: `redactionHardCount`, `redactionMaskCount`.
    - Retention: 90 days for automatic reports, null (indefinite) for user reports.

15. **Agent context filtering** (bug-report-service.ts, lines 130–157).
    - `stopReason`, `runtimeStatus`, `contextPressureBand`, etc. only persisted for agent/worker source.
    - User/renderer/main source reports drop agent context even if passed in (fail-safe).

## Capabilities (Stable IDs)

- **CAP-vexapp-secrets-status** — read vault configured + unlocked state
- **CAP-vexapp-secrets-unlock** — unlock vault with master password (throttled)
- **CAP-vexapp-secrets-lock** — explicit session relock
- **CAP-vexapp-secrets-setup** — initialize master password (onboarding)
- **CAP-vexapp-wallet-export-private-key** — export wallet private key to clipboard with auto-clear (throttled, re-auth)
- **CAP-vexapp-wallet-list-available** — list all wallets in inventory
- **CAP-vexapp-wallets-list-session** — list per-session wallet scope
- **CAP-vexapp-wallets-set-scope** — set per-session wallet selection (CAS)
- **CAP-vexapp-wallet-get-prepared-intent** — query wallet transaction intent (projection)
- **CAP-vexapp-wallet-cancel-prepared-intent** — cancel pending wallet intent (CAS)
- **CAP-vexapp-telemetry-report-renderer-error** — forward renderer error to Sentry (consent-gated)
- **CAP-vexapp-support-create-bug-report** — persist local bug report with redaction

## Public API (Consumed By)

**Renderer:**
- Unlock/lock screens (`vex-app/src/renderer/scenes/onboarding/unlock-screen.tsx`)
- Settings telemetry toggle (`vex-app/src/renderer/scenes/settings/telemetry-settings.tsx`)
- Wallet picker / balance view (calls `listAvailable`, `listSessionWallets`)
- Export button (calls `exportPrivateKey` with re-typed password)
- Bug report modal (calls `createBugReport`)
- Error boundary / caught errors (calls `reportRendererError`)

**Agent executor:**
- Wallet scope resolved at session start (reads `listSessionWallets` result).
- Prepared intents queried/cancelled during mission execution.

**Onboarding:**
- `vex-app/src/main/ipc/onboarding/provider.ts` (line 70–73): writes `OPENROUTER_API_KEY` to vault, then calls `resetProvider()` to reload env.

**Lifecycle:**
- App startup: `initSentryIfConsented()` called from ready hook.
- App quit: `globalCleanup.runAll()` runs all cleanup tasks (clipboard lease + bug-report transport).
- Preferences change: telemetry toggle calls `disableSentry()` or `initSentryIfConsented()`.

## Internal Flow

### Unlock Sequence (End-to-End)

1. **Renderer:** User types master password on unlock screen, sends IPC `CH.secrets.unlock`.
2. **Handler** (ipc/secrets.ts:51–91):
   - Gate check: `checkUnlockAllowed()` returns allowed/retryAfterMs.
   - If locked out: return throttle error with retry hint.
   - Call `unlockSecretSession(password)` (secrets/session.ts:101–113).
3. **Session module:**
   - Call `unlockSecretVault(password, { filePath })` from `@vex-lib/local-secret-vault`.
   - On success: call `applySecretVaultToProcessEnv(password)` (injects `OPENROUTER_API_KEY` etc. to `process.env`).
   - Call `stripManagedSecretsFromDotenvFile()` (cleanup).
   - Set `unlockedMasterPassword = password`.
   - Return `ok({ unlocked: true })`.
4. **Handler resumes:**
   - If error code is "invalid_password": call `recordUnlockFailure()`, advance counter.
   - If unlocked: call `recordUnlockSuccess()`, reset counter.
   - Log and return to renderer.
5. **Result:** `process.env.OPENROUTER_API_KEY` now available; renderer can enable agent actions.

### Wallet Export Sequence (End-to-End)

1. **Renderer:** User clicks export button on wallet view, prompted for master password.
   - Precondition: session already unlocked (UI enforces via status check).
2. **Renderer:** User types password, sends IPC `CH.wallet.exportPrivateKey` with { chain, walletId, password }.
3. **Handler** (ipc/wallet-export.ts:127–327):

   **Step 1 — Throttle gate** (lines 136–156):
   - Call `checkExportAllowed()`.
   - If locked out: return error + `retryAfterMs`.

   **Step 2 — Session unlock check** (lines 158–174):
   - Call `getSecretSessionStatus()`.
   - If not unlocked: return "keystore_locked" error.
   - (Renderer is expected to gate the button if not unlocked; this is defense-in-depth.)

   **Step 3 — Sudo-style re-auth** (lines 176–257):
   - Call `verifySecretVaultPassword(input.password, { filePath })`.
   - On success: no return value, no state mutation.
   - On wrong password: catch `LocalSecretVaultError("invalid_password")`, call `recordExportFailure()`.
     - If lockout triggered (5th failure): call `lockSecretSession()`, return "keystore_locked".
     - Otherwise: return "password_invalid" + optional `retryAfterMs` hint.
   - On IO/vault-missing error: return generic "vault_not_configured" or "internal.unexpected".

   **Step 4 — Resolve wallet** (lines 259–268):
   - Call `getWalletById(input.chain, input.walletId)`.
   - If null: return `invalidWalletSelectionError()` (fail closed, no decrypt attempt).

   **Step 5 — Decrypt + verify** (lines 270–302):
   - Call `decryptExportSecret({ family, entry, password })` from `@vex-lib/wallet`.
   - Decryption happens inside engine; plaintext returned in `secret` string.
   - Address verified inside engine; mismatch throws `VexError`.
   - On success: `secret` now holds plaintext (EVM hex or Solana base58).
   - On keystore-not-found: return "keystore_missing".
   - On address-mismatch / corrupt ciphertext: return "keystore_corrupt".

   **Step 6 — Clipboard lease** (lines 304–309):
   - Call `acquireLease(secret)` from wallet-export-clipboard-lease.ts.
   - Inside `acquireLease()`:
     - Cancel prior lease (null activeLease, unregister, clear timer).
     - Compute `secretHash = SHA-256(secret)`.
     - Call `clipboard.writeText(secret)`.
     - Arm timer: after 10s, check if `activeLease?.token === token` and hash matches clipboard, conditionally clear.
     - Register quit-cleanup task: same idempotent check, conditional clear on app quit.
   - Set `secret = ""` (allow string to drop from scope).

   **Step 7 — Audit log** (lines 311–315):
   - Log `[ipc:vex:wallet:exportPrivateKey] chain=... walletId=... format=... correlationId=...` (metadata only, never the secret).

   **Step 8 — Success response**:
   - Call `recordExportSuccess()` (reset throttle counter).
   - Return `ok({ chain, format, copied: true, clearAfterMs: 10_000 })`.

4. **Renderer:** Shows "Copied to clipboard; will clear in 10 seconds" UI.
5. **Timer** (after 10s):
   - Check if current clipboard text SHA-256 matches `secretHash`.
   - If match: call `clipboard.clear()`.
   - If no match (user copied something else): no-op (intentional).
   - Unregister cleanup task.
6. **App quit:**
   - `globalCleanup.runAll()` fires lease cleanup callback.
   - Same idempotent conditional clear (no-op if timer already fired).

## Dependencies

**Vex libraries** (unprivileged, read-only on codebase):
- `@vex-lib/local-secret-vault.js` — vault encryption/decryption (AES-256-GCM, scrypt)
- `@vex-lib/secret-keys.js` — vault secret key enum (OPENROUTER_API_KEY, Polymarket, etc.)
- `@vex-lib/wallet.js` — wallet inventory, keystore decrypt, address derivation
- `@vex-lib/diagnostics/redactor.js` — field-name + secret-pattern redaction for bug reports
- `@vex-lib/polymarket.js` — Polymarket credential parsing (per-address map)

**Electron APIs:**
- `electron.clipboard` — read/writeText, clear
- `electron.app` — getPath("userData"), getVersion(), quit hooks

**Node built-ins:**
- `node:crypto` — SHA-256 hashing for clipboard lease
- `node:fs/promises` — install-id read, Sentry offline-queue rm
- `node:path` — offline-queue path resolution

**Third-party:**
- `zod` — IPC input/output schema validation
- `@sentry/electron` — error reporting (dynamic import, consent-gated)
- `electron-log` — structured logging with redaction integration

**Internal vex-app:**
- `main/secrets/session.ts` — master password orchestration
- `main/secrets/unlock-throttle.ts` — unlock rate-limiting
- `main/wallet/export-throttle.ts` — export rate-limiting + lockout
- `main/ipc/register-handler.ts` — IPC handler framework
- `main/database/sessions-db.ts` — per-session wallet scope queries
- `main/database/bug-reports-db.ts` — local bug-report persistence
- `main/preferences/store.ts` — telemetry consent state
- `main/logger/redact.ts` — field-name + secret-pattern redactor
- `main/lifecycle/cleanup-registry.ts` — app-quit cleanup coordinator
- `main/paths/config-dir.ts` — file paths (vault, env, install-id)

## Cross-References

**Security audit:**
- FINDING-security-003: Vault lock does not clear process.env keys (documented, intentional).
- FINDING-security-004: RESOLVED — keystore + vault both scrypt N=2^17 (131072) parity (F10-OWASP, commit 1c858ee).

**ADR-0001:**
- Global model (AGENT_MODEL + OPENROUTER_API_KEY in vault).
- Per-session wallets (sessions.selected_evm_wallet_id, etc.).

**Related modules:**
- `module.vex-app.main-bootstrap-lifecycle` — app startup, ready hooks.
- `module.vex-app.main-ipc-engine-orchestration` — engine DB, prepared intents.
- `module.src-root.lib-vault-secrets` — vault encryption primitives.
- `module.src-root.lib-wallet` — wallet keystore, address derivation.

**Related fixes:**
- `fix-plan.F1` — "Model not configured" root cause (env not loaded until unlock).

## Refresh Triggers

This module is stale if:

1. **Unlock throttle logic changes** — watch `vex-app/src/main/secrets/unlock-throttle.ts`.
2. **Export throttle or lockout behavior changes** — watch `vex-app/src/main/wallet/export-throttle.ts`.
3. **Clipboard lease TTL changes** — spec-locked at 10s (`CLEAR_AFTER_MS = 10_000`); any change requires renderer UX audit.
4. **Master password clearing scope changes** — currently clears only `unlockedMasterPassword` ref, not `process.env`.
5. **Vault encryption KDF params change** — any N value change (currently 65536 for vault, 16384 for keystore).
6. **Sentry initialization or consent logic changes** — watch `vex-app/src/main/telemetry/sentry-lifecycle.ts`.
7. **Breadcrumb allowlist changes** — currently "navigation", "vex.ipc", "vex.wizard" (lines 25–29 of before-send.ts).
8. **Bug report redaction scope changes** — watch `@vex-lib/diagnostics/redactor.js` and `main/support/bug-report-service.ts`.
9. **Per-session wallet scope schema changes** — watch `src/vex-agent/db/migrations/**` for wallet scope table.
10. **Telemetry consent preference structure changes** — watch `main/preferences/store.ts` and schema.

## Open Questions

### BLOCKED_QUESTION: Idle-lock timer presence

**Status:** CONFIRMED ABSENT.

Grep confirms no idle-lock timer in:
- `vex-app/src/main/secrets/**`
- `vex-app/src/main/lifecycle/**`
- `vex-app/src/main/index.ts` (main process entry)

Only references to "idle" are in comments re: executor waiting for provider config to be injected.

**Interpretation:** Lock is explicit only (user clicks button, throttle triggers at 5 export failures). No automatic timeout-based relock.

### BLOCKED_QUESTION: Complete vault-injected env list

**Status:** PARTIALLY CONFIRMED.

From `secrets/session.ts:75` call to `applySecretVaultToProcessEnv(password, { filePath })`:
- This calls the `@vex-lib/local-secret-vault` function, which decrypts the vault and injects all secrets.
- Specific keys are defined in `@vex-lib/secret-keys.ts` enum `VAULT_SECRET_KEYS`.

**Known injected keys:**
- `OPENROUTER_API_KEY` (used by agent executor).
- Polymarket credentials: `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE`, `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`.

**Uncertainty:** Is the list complete? No documentation found listing ALL possible vault keys.

**Recommendation:** Verify against `src/lib/secret-keys.ts` line-by-line to confirm completeness before finalizing vault audit.

### BLOCKED_QUESTION: Telemetry redaction vs diagnostics redaction

**Status:** HIGH CONFIDENCE SAME SOURCE.

Both use `redact()` from `main/logger/redact.ts`:
- `before-send.ts` line 97: `scrubMessage(redact(event.message))`
- `bug-report-service.ts` line 97: `redactBugPayload()` wraps `@vex-lib/diagnostics/redactor.js`

**Uncertainty:** Is `@vex-lib/diagnostics/redactor.js` identical to `main/logger/redact.ts`, or different implementations?

**Recommendation:** Confirm both sources apply the same secret patterns (0x-hex, base64, JWT, field names, etc.).

### BLOCKED_QUESTION: Clipboard lease TTL spec dependency

**Status:** CONFIRMED SPEC-LOCKED.

`CLEAR_AFTER_MS = 10_000` (line 25 of wallet-export-clipboard-lease.ts).

Comment at lines 20–24 states: "Spec-locked at 10_000ms — do not bump without revisiting the renderer UX copy that promises this exact value."

**Recommendation:** Grep for "10 second" or "10s" in renderer code to confirm UX messaging matches.

### BLOCKED_QUESTION: Renderer clipboard paste vs system clipboard race

**Status:** MITIGATED BY DESIGN.

Clipboard lease uses SHA-256 conditional clear, not plaintext comparison.

If user pastes during 10s window, both are possible:
1. User pastes the secret into an app → different clipboard content → hash mismatch → no-op clear.
2. User pastes over the secret with something else → different hash → no-op clear.

**Risk:** If user immediately re-exports the same wallet (same secret), SHA-256 could match a stale secret from prior export. However:
- Monotonic token check (`activeLease?.token !== token`) prevents timer/cleanup from clearing a newer lease's secret.
- Order of operations in replacement (null activeLease BEFORE unregister) ensures no race.

**Confidence:** HIGH. The replacement protocol is sound.

### LOW_CONFIDENCE_FINDING: Renderer wallet picker sync with session wallet scope

**Status:** NEEDS CONFIRMATION.

Code shows:
- `listAvailable()` returns inventory {evm, solana} addresses.
- `setSessionWalletScope()` updates session selection (CAS).
- `listSessionWallets()` returns per-session scope.

**Uncertainty:** Does the renderer UI properly:
1. Show available wallets when no session exists?
2. Lock picker after session creation (selection immutable)?
3. Persist selection across page reloads?
4. Handle unknown wallet IDs gracefully (in case DB corruption)?

**Recommendation:** Review wallet-picker UI implementation to confirm it enforces immutability post-creation and handles error cases.

### LOW_CONFIDENCE_FINDING: Sentry offline queue cleanup safety

**Status:** HIGH CONFIDENCE SAFE, LOW CONFIDENCE COMPLETENESS.

`disableSentry()` (line 121–140 of sentry-lifecycle.ts) calls `rmOfflineQueue()`:
- Deletes `${userData}/sentry` directory.
- Uses `fs.rm(..., { recursive: true, force: true })`.

**Confidence:** This clears the offline queue on consent revoke (lines 121–140).

**Uncertainty:** Are there other Sentry state artifacts (e.g., session state, transports)? Sentry docs should confirm.

**Recommendation:** Verify against Sentry's `close(timeout)` and offline-storage API that no other state persists.

### LOW_CONFIDENCE_FINDING: Electron clipboard API error handling

**Status:** BEST-EFFORT ONLY.

`clearIfStillOurs()` (lines 61–72 of wallet-export-clipboard-lease.ts) catches clipboard read/write errors:
```typescript
try {
  const current = clipboard.readText();
  if (hashSecret(current) === secretHash) clipboard.clear();
} catch (cause: unknown) {
  log.warn("[wallet:export] clipboard cleanup probe failed", cause);
}
```

**Confidence:** Errors are logged and execution continues (best-effort).

**Uncertainty:** On X11 without a selection server, what is the exception? Does silent catch lose important context?

**Recommendation:** Verify against Electron's clipboard API docs that this catch covers all platform-specific failures.

### LOW_CONFIDENCE_FINDING: Throttle counter persistence across relaunch

**Status:** CONFIRMED RESETS ON RELAUNCH.

Both throttle modules comment at lines ~73–78:
```typescript
// Module state is local to the main process; it resets on every relaunch.
```

**Interpretation:** Counters are not persisted to disk. An attacker who gains process-level access can restart the app to reset throttle.

**Risk level:** LOW, because:
1. Process-level access to a single-user desktop already grants access to clipboard, screenshots, etc.
2. Restarting the app logs the attempt in `log.warn()`.
3. Vault KDF (N=2^17=131072) is the real defense, not throttle alone.

**Confidence:** HIGH. Throttle is in-process rate-limiting only, not a cryptographic boundary.

