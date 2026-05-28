---
id: boundary.env-secrets
kind: boundary
paths:
  - src/lib/local-secret-vault.ts
  - src/lib/secret-keys.ts
  - src/lib/runtime-env.ts
  - src/providers/env-resolution.ts
  - src/utils/dotenv.ts
  - src/config/paths.ts
  - vex-app/src/main/paths/config-dir.ts
  - vex-app/src/main/secrets/**
  - vex-app/src/main/onboarding/**
  - vex-app/src/main/ipc/onboarding/**
  - vex-app/src/main/ipc/secrets.ts
  - vex-app/src/main/wallet/**
  - vex-app/src/main/ipc/wallet-export*.ts
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - src/lib/local-secret-vault.ts
  - src/lib/secret-keys.ts
  - src/lib/runtime-env.ts
  - src/providers/env-resolution.ts
  - src/utils/dotenv.ts
  - src/config/paths.ts
  - src/lib/agent-config.ts
  - src/tools/wallet/keystore.ts
  - vex-app/src/main/paths/config-dir.ts
  - vex-app/src/main/secrets/**
  - vex-app/src/main/onboarding/**
  - vex-app/src/main/ipc/onboarding/**
  - vex-app/src/main/ipc/secrets.ts
  - vex-app/src/main/wallet/**
  - vex-app/src/main/ipc/wallet-export*.ts
related:
  - module.vex-app.main-secrets-wallet-support
  - module.vex-app.main-docker-compose-onboarding
  - module.vex-app.main-bootstrap-lifecycle
  - module.src-root.lib-vault-secrets
  - module.src-root.lib-wallet
  - module.src-root.lib-env-config
  - module.vex-agent.inference
  - fix-plan.F1
  - ADR-0001-global-model-session-wallet
  - audit.current.security-review
---

# boundary.env-secrets — Non-secret `.env` vs vault vs keystore

## Three storage zones (all under `${CONFIG_DIR}`)

`${CONFIG_DIR}` resolves to `%APPDATA%/vex` (Windows), `~/Library/Application Support/vex` (macOS), `~/.config/vex` (Linux). Resolver duplicated intentionally in `src/config/paths.ts` (root MCP/CLI) and `vex-app/src/main/paths/config-dir.ts` (Electron main). Drift between the two = split storage; tracked under quality-findings.

| Zone | File(s) | Crypto | Holds | Lifetime |
|---|---|---|---|---|
| Non-secret env | `.env` | none (plain text) | `AGENT_MODEL`, `AGENT_PROVIDER`, `AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`, `SUBAGENT_*`, `EMBEDDING_*` | persistent on disk |
| Vault | `secrets.vault.json` | AES-256-GCM + scrypt N=65536 | `OPENROUTER_API_KEY`, `JUPITER_API_KEY`, `TAVILY_API_KEY`, `RETTIWT_API_KEY`, Polymarket creds, wallet private keys (per-chain wallet keystores live in separate file but share password discipline) | persistent encrypted; decrypted into memory on unlock |
| Keystore | `keystore.json` / `solana-keystore.json` | AES-256-GCM + scrypt N=16384 (WEAKER than vault) | EVM wallet private key, Solana wallet private key | persistent encrypted |
| Public config | `config.json` | none | Public wallet addresses, chain/RPC/service URLs | persistent on disk |
| Markers | `.setup-complete`, `.install-id`, `.electron-state/{preferences,wizard-state}.json` | none | Setup status, telemetry id, persisted wizard state | persistent on disk |
| Rendered compose | `compose/docker-compose.yml` | none | Rendered template with `127.0.0.1` binds, SCRAM Postgres secrets in compose secrets | rendered each up |

## What can hold a secret

- **Vault & keystore on disk.** Encrypted at rest. Both require the master password to decrypt.
- **`process.env`** at runtime. Vault unlock injects `OPENROUTER_API_KEY` (and other tracked keys) into `process.env`. Engine reads via `process.env.OPENROUTER_API_KEY`.
- **Renderer.** NEVER. Password fields use uncontrolled refs cleared synchronously before await. No `setState(password)`, no TanStack cache entries, no Zustand persist for any secret.
- **Logs.** NEVER. Writers log field names only. Diagnostics layer (`src/lib/diagnostics/text-redaction.ts`) redacts known secret patterns before emit.

## Crossing rules

- Renderer asks main to unlock/lock via `CH.secrets.*`. Master password is sent in request envelope, used immediately, never echoed back. Result returns status only.
- Engine calls (e.g. inference) read from `process.env`; they do not unlock or decrypt anything themselves.
- Wallet keystore unlock happens on `wallet-export` or signing operations — separate password prompt; main re-derives key, never persists plaintext.
- Polymarket auto-setup writes vault credentials only after wallet signs the derivation challenge; renderer never sees the credentials.
- Telemetry / bug reports go through redaction (`src/lib/diagnostics/`) before any persistence or external send.

## Lock semantics (current behavior — see FINDING-security-003)

- `lockSecretSession()` (`vex-app/src/main/secrets/session.ts`) clears the in-memory master password reference.
- `lockSecretSession()` does NOT clear vault-injected API keys from `process.env`. They persist for the current process lifetime.
- UI behavior on lock: renderer routes to UnlockScreen if it tries to use a privileged path that requires the password. The engine continues to have access to the previously-injected keys.
- Verdict: intentional today; documented as an open security/posture question. Two reasonable resolutions exist: (a) sweep tracked keys on lock (UX trade-off: in-flight engine work fails), or (b) document explicitly and leave as-is.

## F1 boot order

1. Electron `whenReady` fires.
2. `vex-app/src/main/index.ts:116 loadProviderDotenv()` reads `${CONFIG_DIR}/.env` into `process.env`. No vault values yet.
3. `registerAllIpcHandlers()` registers IPC.
4. `setupCompactWorker()` + `setupWakeWorker()` start; both have provider gates that will hold until vault unlocks.
5. Renderer requests vault unlock; main injects `OPENROUTER_API_KEY` into `process.env`.
6. Workers' next ticks see ready provider, proceed.

Provider persist path (onboarding step) does the same in reverse: write `.env` and vault inside `withEnvWriteLock` → `loadProviderDotenv({overwrite:true})` → `resetProvider()` to invalidate the engine's cached singleton.

## Invariants

- Secrets ONLY flow main ↔ disk and main ↔ process.env. NEVER reach renderer.
- `withEnvWriteLock()` serializes all `.env` writes across wizard steps and IPC retries.
- Atomic writes (temp + rename) for `.env`, vault, keystore — partial-write rollback is automatic.
- Vault scrypt N=65536 ≥ keystore N=16384 (4× weaker is tracked as `FINDING-security-004`).
- ADR-0001: `AGENT_MODEL` / `AGENT_PROVIDER` are global; no per-session model env override.
- Wallet selection is per-session at session creation; the SELECTED wallet's keystore is unlocked on demand (signing time).
- Clipboard lease for private-key export uses a TTL token; renderer cannot reuse a stale token.

## Refresh triggers

Any change to: `src/lib/local-secret-vault.ts`, `secret-keys.ts`, `src/utils/dotenv.ts`, `src/providers/env-resolution.ts`, `src/config/paths.ts`, `vex-app/src/main/paths/config-dir.ts`, the vault/keystore writers under `vex-app/src/main/onboarding/`, `vex-app/src/main/secrets/`, or any `src/tools/wallet/*` file that touches keystore IO.

## Cross-references

- `module.src-root.lib-vault-secrets` — vault crypto + secret key inventory.
- `module.src-root.lib-wallet` — keystore + inventory + multi-auth + signing.
- `module.src-root.lib-env-config` — dotenv overwrite flag + `runtime-env` facade + `providers/env-resolution`.
- `module.vex-app.main-secrets-wallet-support` — Electron-side wiring, throttles, clipboard lease, lifecycle hooks.
- `module.vex-app.main-docker-compose-onboarding` — wizard writers + `withEnvWriteLock`.
- `boundary.process-boundaries` — what cannot cross at all.
- `fix-plan.F1` — model/provider env boot + reload.
- `audit.current.security-review` — FINDING-security-003 (lock semantics), 004 (KDF asymmetry).
