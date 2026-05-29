---
id: module.vex-app.main-docker-compose-onboarding
kind: module
title: Main Process Docker/Compose Lifecycle & Onboarding Wizard Backend
description: Unified deep module documentation for Vex Electron main-process Docker daemon management, Compose template rendering, local services lifecycle, and multi-step onboarding wizard state persistence and secret management.
paths:
  - vex-app/src/main/docker/
  - vex-app/src/main/compose/
  - vex-app/src/main/onboarding/
  - vex-app/src/main/ipc/docker.ts
  - vex-app/src/main/ipc/onboarding.ts
  - vex-app/src/main/ipc/onboarding/
  - vex-app/resources/compose/docker-compose.template.yml
  - vex-app/scripts/check-build-artifacts.mjs
  - vex-app/scripts/copy-migrations.mjs
source_commit: 1c858ee
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/resources/compose/docker-compose.template.yml
  - vex-app/src/main/docker/*.ts
  - vex-app/src/main/compose/*.ts
  - vex-app/src/main/onboarding/*.ts
  - vex-app/src/main/ipc/docker.ts
  - vex-app/src/main/ipc/onboarding.ts
  - vex-app/src/main/ipc/onboarding/*.ts
  - vex-app/src/shared/embedding-defaults.ts
related:
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-database-migrations
  - module.vex-app.main-secrets-wallet-support
  - module.vex-app.preload-channels-events-errors
  - module.src-root.lib-env-config
  - module.src-root.lib-vault-secrets
  - module.src-root.lib-wallet
  - module.vex-agent.data-memory-knowledge
  - fix-plan.F1
  - audit.current.security-review
  - audit.current.quality-findings
---

## Purpose

This module owns:

1. **Docker daemon management** — probe, install, start, endpoint policy validation (local-only).
2. **Compose lifecycle** — template rendering with per-install secrets, `docker compose up/down`, port conflict detection, health checks for Postgres + embeddings runtime.
3. **Onboarding wizard backend** — multi-step state persistence, environment variable writes, API key vault storage, keystore password initialization, wallet and Polymarket credential management, finalization ceremony.
4. **Secrets isolation** — vault-backed secret storage (API keys, provider credentials), `.env` non-secret-only writes, password-protected keystore initialization.

The **renderer is untrusted** and never imports or calls any Docker, Compose, wallet, vault, or onboarding writer directly. Main process owns all privileged operations; the renderer receives only non-secret status via IPC handlers.

---

## Retrieval Keywords

`Docker daemon`, `endpoint policy`, `install URL`, `compose render`, `$$VAR escape`, `llama.cpp embeddings`, `model runner legacy`, `embedding dim 768`, `.env writer`, `vault writer`, `env-write-mutex`, `wallet-mutex`, `provider-writer`, `resetProvider`, `finalize`, `setup-complete`, `wizard-state-store`, `SCRAM Postgres`, `named volumes`, `local bind`, `F1 reload`, `F10 keystore`, `F13 embeddings`

---

## State Owned

### Write Mutexes (Serialization)

- **`env-write-mutex.ts`** — global serializer for all `.env` mutations via `withEnvWriteLock()`. Prevents concurrent write-modify-write races from `keystoreSet`, `apiKeysSet`, `embeddingConfigure`, `agentCoreConfigure`, `providerPersist` (M9). Does NOT poison on rejection; a failed write never blocks subsequent ones. Process-local only; cross-process collisions remain Phase 1 risk per codex turn 2 RED #7.

- **`wallet-mutex.ts`** — global serializer for wallet operations via `withWalletLock()`. Coordinates keystore.json + solana-keystore.json + config.json + autoBackup() together because they form a single transaction domain. Different from env-mutex because wallet state spans multiple files and backup generation.

### Install & Compose State

- **`.install-id`** — immutable per-install UUID generated once at first render, stored in `${userDataDir}/.install-id`. Controls stable naming for volumes, compose project name, secrets directory.

- **`docker-compose.yml`** — rendered once per launch in `${userDataDir}/compose/docker-compose.yml` from the template. Contains substituted install-id, port overrides, and secret file path. Atomic write via temp + rename in `render.ts:renderCompose()`.

- **Postgres password secret** — generated or reused in `${userDataDir}/local-infra/secrets/pg_password`. Read/write via injected `SecretAdapter` (DPAPI on Windows, mode 0o600 on POSIX). Re-written at every render for freshness (transient cache cleanup via `bootCleanup`).

- **`.setup-complete`** — written once during finalization in `${CONFIG_DIR}/.setup-complete` (mode 0o600). Belt-and-suspenders gate: wizard completion state is authoritative; this flag aids boot-time detection.

### Wizard & Configuration State

- **`wizard-state-store.ts`** — filesystem-backed store managing `currentStepId`, `completedSteps` array, `completed` boolean. Idempotent `update()`, defensive `peekCompleted()` (does not create defaults on missing file), single-flight `finalize()` via module-scope promise (re-entrant call returns the first call's promise).

- **`.env`** — non-secret environment configuration. Written by:
  - `env-write.ts` (generic append-only) used by all wizard step writers.
  - **Never** contains API keys, private keys, or passwords (those go to vault).
  - Contains: `AGENT_MODEL`, `AGENT_PROVIDER`, `EMBEDDING_BASE_URL`, `EMBEDDING_DIM`, `EMBEDDING_MODEL`, `EMBEDDING_PROVIDER`, `JUPITER_CONFIGURED`, `TAVILY_CONFIGURED`, `RETTIWT_CONFIGURED`, `POLYMARKET_CONFIGURED`, `AGENT_CORE_CONFIGURED`.

- **Encrypted vault secrets** — stored in `${CONFIG_DIR}/.vex-secrets` (implementation in `src/lib/local-secret-vault.ts`). Written by `writeUnlockedSecrets()` under the session-locked master password. Contains: `OPENROUTER_API_KEY`, `JUPITER_API_KEY`, `TAVILY_API_KEY`, `RETTIWT_API_KEY`, `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE`.

- **Keystore files** — encrypted EVM (Solana) wallets. NOT touched by wizard; wallet operations write them via `@vex-lib/wallet.ts`. Master password stays in main-process memory only; keystore password is input during Step 1, passed to `initializeMasterPassword()`, never logged.

---

## Boundary Crossings

### Docker CLI ↔ Host

- **`spawn-runner.ts`** — wraps `child_process.execFile` with AbortController + per-command timeout. Never uses `spawnSync` (would freeze Electron main thread). All Docker commands route through here.
- **`daemon.ts`** — checks `docker info`, auto-starts Docker if needed (platform-specific), polls readiness.
- **`endpoint-policy.ts`** — **REJECTS remote Docker contexts** (SSH, TCP). Only accepts `unix://`, `npipe://`, `fd://` (local Unix socket, Windows named pipe, systemd socket). Hard gate at lines 42–50.

### Renderer → Main IPC

- **`ipc/docker.ts`** — handler entry for Docker Bootstrap flow (`dockerBootstrap`, `getDockerBootstrapState`). Renderer calls it but receives only non-secret status (daemon readiness, next UI action).
- **`ipc/onboarding.ts`** — entry for all wizard handlers. Renderer submits input (API key, password, wallet seed, etc.); handlers validate, write, and return non-secret completion status.
- **`ipc/onboarding/*.ts`** — individual step handlers: `keystoreSet`, `walletGenerate`, `walletRestore`, `walletImport`, `apiKeysSet`, `embeddingConfigure`, `agentCoreConfigure`, `providerPersist`, `polymarketSetup`, `completeSetup`.

### Compose Secret Adapter

- **`SecretAdapter`** — injected interface with read/write/cleanup/bootCleanup methods. Main process passes `electronSecretAdapter` (DPAPI Windows, POSIX file mode). Tests pass deterministic in-memory adapters.
- **Postgres password flow** — adapter reads (decrypts if needed), adapter writes (encrypts if needed). Render always regenerates the password via adapter on each compose up, ensuring fresh transients.

### `lib-vault-secrets` ↔ Main

- **`writeUnlockedSecrets({})`** — takes a dict of `{ KEY: value }` pairs, encrypts under the session-locked master password, writes to vault. Used by `api-keys-writer.ts`, `provider-writer.ts`, others.
- **`getUnlockedSecretPresence()`** — probes vault without decrypting; returns presence boolean. Used by `env-state.ts` to report "API key configured" without leaking the value.

### Engine ↔ Provider Cache (F1)

- **`provider.ts` lines 66–75** — after `writeProvider()` succeeds:
  1. `loadProviderDotenv({ overwrite: true })` reloads the (non-secret) `.env` into `process.env`.
  2. **`resetProvider()`** is imported from `@vex-agent/inference/registry.js` and called immediately.
  3. Both operations run inside `withEnvWriteLock()` so coherence is guaranteed before the handler returns success.
- This ensures the next `resolveProvider()` call (agent startup) sees fresh model / API key state.

### Database & Embeddings Health

- **`pg-health.ts`** — synchronous `pgConnectProbe()` that tries a quick TCP dial + Postgres auth handshake. Called by `lifecycle.ts` after `compose up` to gate main-bridge handoff.
- **`embeddings-health.ts`** — async polling (GET `/health`, POST `/v1/embeddings` with 1-token probe) on `http://127.0.0.1:${embedPort}/v1`. Validates embedding dimension = 768 (catch for compose template ↔ embedding-defaults.ts drift). Returns discriminated union `{ kind: "ready" | "timeout" | "dim_mismatch" | "aborted", ... }`.
- **Port only**: `:55134` (default `DEFAULT_EMBED_PORT`). Legacy `:12434` references are drift/status only (F13 closed); not currently probed.

---

## File Map

### Docker Daemon & Installation

| File | Key Symbols & Lines |
|------|-----|
| `docker/daemon.ts` | `checkDockerDaemon()` (lines 32–67), `ensureDockerDaemonReady()` (lines 69–120), re-probes and auto-starts if needed |
| `docker/endpoint-policy.ts` | `inspectDockerEndpointPolicy()` (lines 108–137), `classifyDockerEndpoint()` (lines 52–106), `isAcceptedLocalDockerHost()` (lines 42–50) — **rejects remote contexts** |
| `docker/install.ts` | Docker installation workflow for macOS/Windows/Linux; references `installer-urls.ts` |
| `docker/installer-urls.ts` | Platform-specific Docker install URLs, SHA256 verification, installer invocation |
| `docker/probe.ts` | `parseDockerVersion()`, `parseComposeVersion()`, `parseSemver()`, `COMPOSE_VERSION_FLOOR = "2.23.1"`, port/HTTP probes |
| `docker/progress-bus.ts` | EventEmitter-based progress reporting for install/start operations |
| `docker/spawn-runner.ts` | `runSpawn()` wraps `child_process.execFile` with AbortController + timeout; no `spawnSync` |
| `docker/start.ts` | Platform-specific Docker daemon startup (macOS Desktop app, Linux systemd, Windows service) |

### Compose Rendering & Lifecycle

| File | Key Symbols & Lines |
|------|-----|
| `resources/compose/docker-compose.template.yml` | Service definitions: `db` (Postgres+pgvector), `embeddings-model-init` (curl init), `embeddings-runtime` (llama.cpp:server). Named volumes with `vex-install` labels. **$$VAR escaping** in init script (lines 154–191) |
| `compose/render.ts` | `renderCompose()` (lines 123–160), `getInstallId()` (lines 92–102), `getPgPassword()` (lines 104–121). Atomic temp+rename write. Deps injected: `SecretAdapter`, `RandomAdapter`, `CryptoAdapter` |
| `compose/deps-factory.ts` | Factory for compose dependencies (secret adapter, random UUID, crypto base64url) |
| `compose/electron-secret-adapter.ts` | DPAPI (Windows) secret adapter implementation |
| `compose/posix-secret-adapter.ts` | POSIX file-mode 0o600 secret adapter implementation |
| `compose/lifecycle.ts` | `composeUp()` (probes floor, checks ports, renders, runs health checks), `composeDown()` (stop preserves volumes), `checkComposeFloor()` (lines 45–63). **Stale bind-mount recovery** (lines 95–181) — destructive only if setup incomplete |
| `compose/pg-health.ts` | `pgConnectProbe()` — quick TCP + Postgres auth validation |
| `compose/embeddings-health.ts` | `waitForEmbeddingsRuntimeReady()` (lines 147–227), polls GET `/health` + POST `/v1/embeddings`, validates `dim === EMBEDDING_DIM` (768). Discriminated union result |

### Onboarding Writers & State

| File | Key Symbols & Lines |
|------|-----|
| `onboarding/env-write-mutex.ts` | `withEnvWriteLock()` (lines 26–51) — global chain-of-promises serializer. Does NOT poison on rejection |
| `onboarding/wallet-mutex.ts` | `withWalletLock()` (lines 24–49) — global serializer for keystore + config mutations |
| `onboarding/wizard-state-store.ts` | `WizardStateStore` with `.load()`, `.update()`, `.peekCompleted()`, single-flight `.finalize()` |
| `onboarding/env-state.ts` | `gatherEnvState()` — probes file presence (keystores, `.env`, config.json), reads env keys non-destructively, returns `EnvState` shape. **Never decrypts keystores** (codex turn 3 RED #3) |
| `onboarding/embedding-defaults.ts` | Re-exports `EMBEDDING_DIM = 768`, `EMBEDDING_MODEL_ALIAS = "ai/embeddinggemma:300M-Q8_0"`, `DEFAULT_EMBED_PORT = 55134`. Adds server-only: `EMBEDDING_MODEL_SHA256`, `EMBEDDING_MODEL_DOWNLOAD_URL`, `COMPOSE_IMAGES` digests |
| `onboarding/embedding-state.ts` | `probeEmbeddings()` — checks if embeddings base URL is reachable & functional |
| `onboarding/embedding-writer.ts` | `writeEmbedding()` — writes 4 EMBEDDING_* keys to `.env` under env-write mutex |
| `onboarding/env-write-mutex.ts` | Ensures serialized `.env` writes |
| `onboarding/ensure-embedding-defaults.ts` | Idempotent: if embeddings not configured, write defaults |
| `onboarding/keystore-writer.ts` | `setKeystorePassword()` (lines 18–23) — calls `initializeMasterPassword()` under env-write mutex. **Password never logged** |
| `onboarding/api-keys-writer.ts` | `writeApiKeys()` (lines 38–100) — writes Jupiter/Tavily/Rettiwt/Polymarket trio to vault. **Only logs field NAMES, never values** (line 97) |
| `onboarding/provider-writer.ts` | `writeProvider()` (lines 48–95) — writes OpenRouter API key to vault, non-secret provider selection to `.env`. Stores key in vault, sets `.env` vars: `AGENT_MODEL`, `AGENT_PROVIDER=openrouter`. **Never logs apiKey value** (line 91) |
| `onboarding/provider-state.ts` | `probeProvider()` — checks if inference provider is reachable |
| `onboarding/openrouter-test-client.ts` | `verifyOpenRouterConnection()` — 16-token test call, hard 15s timeout, SDK retries disabled |
| `onboarding/wallet-password.ts` | Master password state helpers |
| `onboarding/wallet-restore.ts` | Restore from backup: validate → decrypt → derive addresses → mismatch confirm → backup → atomic copy |
| `onboarding/wallets-runner.ts` | Wallet generation, import, restore primitives; error mapping |
| `onboarding/agent-core-writer.ts` | Writes agent model config (startup prompt, etc.) to vault/config |
| `onboarding/finalize.ts` | **Finalization ceremony (lines 60–216)**. Atomically: validate envState, `autoBackup()`, set `wizardState.completed = true`, apply telemetry consent, write `.setup-complete` flag. Single-flight via module-scope promise |

### IPC Handlers

| File | Key Symbols & Lines |
|------|-----|
| `ipc/docker.ts` | `dockerBootstrap()`, `getDockerBootstrapState()` — renderer-facing handlers for Docker bootstrap flow |
| `ipc/onboarding.ts` | Handler registry: `getEnvState()`, `getWizardState()`, `setWizardState()`, `keystoreSet()`. Re-exports other step handlers |
| `ipc/onboarding/provider.ts` | `registerProviderHandler()` (lines 38–100) — verify connection, persist vault secret, reload env, **`resetProvider()`** call (line 73) |
| `ipc/onboarding/finalize.ts` | `registerFinalizeHandler()` — routes to `completeSetup()` in `finalize.ts` |
| `ipc/onboarding/embedding.ts` | Embedding step handler |
| `ipc/onboarding/api-keys.ts` | API keys step handler |
| `ipc/onboarding/wallets.ts` | Wallet generation/import/restore handlers |
| `ipc/onboarding/agent-core.ts` | Agent core config handler |
| `ipc/onboarding/polymarket-setup.ts` | Polymarket credential handler |
| `ipc/onboarding/polymarket-configured-addresses.ts` | Query Polymarket addresses in current env state |

---

## Key Types & Invariants

### Endpoint Policy (Security)

```ts
// endpoint-policy.ts:42–50
export function isAcceptedLocalDockerHost(host: string | null): boolean {
  if (host === null) return true;
  const lower = host.toLowerCase();
  return (
    lower.startsWith("unix://") ||
    lower.startsWith("npipe://") ||
    lower.startsWith("fd://")
  );
}
```

**Invariant**: Remote Docker (SSH, TCP) is REJECTED at lines 56–64. `endpoint-policy.ts` is the authoritative gate; no other code overrides this check.

### Compose Template: SCRAM + Named Volumes

```yaml
# docker-compose.template.yml:28–33, 43, 138–145
environment:
  POSTGRES_HOST_AUTH_METHOD: scram-sha-256
  POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
volumes:
  vex-postgres-data-${VEX_INSTALL_ID}:/var/lib/postgresql
  vex-embed-models-${VEX_INSTALL_ID}:/models
volumes:
  vex-postgres-data-${VEX_INSTALL_ID}:
    labels:
      vex-install: ${VEX_INSTALL_ID}
```

**Invariants**:
- Postgres uses SCRAM-SHA-256, never MD5.
- Named volumes persist data and embeddings model cache.
- Volumes labeled with `vex-install: <id>` for safe cleanup.
- Ports bind to `127.0.0.1` only (skill §10).
- All images pinned by digest (no `:latest` or tag-only).

### Compose Template: $$VAR Escaping

```bash
# docker-compose.template.yml:154–191 (embeddings-model-init script)
# CRITICAL: every shell $VAR must be doubled to $$ so Compose's
# variable interpolation pass (line 150–159 comment) leaves it alone.

if [ -f "$$MODEL" ]; then
  ACTUAL=$$(sha256sum "$$MODEL" | cut -d' ' -f1)
```

**Invariant**: All shell variable references in `configs.content:` script body use `$$`, not `$`. Render.ts writes YAML via `fs.writeFile()` (no line-ending translation); `$$` stays as-is to the Compose parser, then becomes `$` in the container shell (edge-cases rule 1).

### Embedding Health

```ts
// composet/embeddings-health.ts:47–51, 177–187
const HEALTH_PROBE_TIMEOUT_MS = 3_000;
const EMBEDDINGS_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 4 * 60_000; // 4 min cold start budget

// Invariant: embedding vector length must be exactly 768
if (probe.ok && probe.dim === EMBEDDING_DIM) { // EMBEDDING_DIM = 768
  return { kind: "ready", ... };
}
// Dim mismatch → catch template ↔ embedding-defaults.ts drift
if (probe.ok && probe.dim !== null && probe.dim !== EMBEDDING_DIM) {
  return { kind: "dim_mismatch", ... };
}
```

**Invariants**:
- Probe address is `127.0.0.1` (never `localhost` — IPv6 resolver mismatch risk, codex review turn 2 RED #2).
- Embedding dimension must be exactly 768. Mismatch indicates template/defaults.ts de-sync.
- Cold start budget 4 min (image pull + ~333 MB GGUF download + model load).
- POST `/v1/embeddings` test input is the word `"vex"` (1 token).

### Env-Write Mutex

```ts
// onboarding/env-write-mutex.ts:26–51
export function withEnvWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  // ... chain-of-promises pattern ...
  envChain = next.catch(() => undefined); // Does NOT poison on error
}
```

**Invariant**: Failed writes never block subsequent ones. If wizard step N fails to write `.env`, step N+1 still runs the lock (and may retry or skip).

### Provider Reload (F1)

```ts
// ipc/onboarding/provider.ts:66–75
const persistResult = await withEnvWriteLock(async () => {
  const result = await writeProvider(input);
  if (result.ok) {
    loadProviderDotenv({ overwrite: true }); // Reload .env into process.env
    const { resetProvider } = await import("@vex-agent/inference/registry.js");
    resetProvider(); // Reset provider cache — next resolveProvider() rebuilds
  }
  return result;
});
```

**Invariant**: Provider cache reset happens inside the env-write lock. Main handler does not report success until both `.env` and the cache are coherent. **F1 fix requires this sequence**.

### Finalize Single-Flight

```ts
// onboarding/finalize.ts:58–72
let pending: Promise<Result<CompleteSetupResult>> | null = null;

export function completeSetup(
  input: CompleteSetupInput,
): Promise<Result<CompleteSetupResult>> {
  if (pending) return pending; // Return the existing promise if already in flight
  // ... run finalize, clear pending in finally
}
```

**Invariant**: A second finalize call while the first is in progress returns the first call's promise (including the same `telemetryConsent` value). Renderer disables Finalize button on submit (defense-in-depth).

### Finalize Validation

```ts
// onboarding/finalize.ts:80–101
function listMissingItems(envState: EnvState): IncompleteItem[] {
  // Validates: hasKeystorePassword, walletStatus (evm + solana), 
  // jupiterConfigured, embeddings.allFieldsConfigured, provider.configured
}
```

**Invariant**: Setup cannot finalize if any required field is missing. Renderer gates Review step behind all prior steps, but finalize validates defensively (codex turn 3 RED #1 — fail-safe).

### Compose Stale Bind-Mount Recovery (Destructive Gate)

```ts
// compose/lifecycle.ts:78–93, 109–121
async function isSetupLikelyCompleted(): Promise<boolean> {
  // Only explicit false (setup NOT complete) permits the wipe path.
  // null (unknown) is treated as "assume completed" (fail-safe).
  return wizardCompleted !== false;
}

async function clearStaleSecretCache(...): Promise<ClearStaleSecretCacheResult> {
  if (await isSetupLikelyCompleted()) {
    // Refuse to wipe user data even if stale cache detected
    return { wiped: false };
  }
  // Only pre-setup (wizard.completed === false) permits `compose down --volumes`
}
```

**Invariant**: Destructive recovery (volume wipe) is only allowed when wizard is provably still in-progress. If setup is complete or status is unknown, refuse to destroy user state (codex turn 3 RED #1 fail-safe).

### Secret Logging Discipline

- **`provider-writer.ts:91`** — logs only field path, not value: `"[provider-writer] persisted provider keys to ..."`
- **`api-keys-writer.ts:97`** — logs only key names: `"[api-keys-writer] persisted vault keys=JUPITER_API_KEY,TAVILY_API_KEY"`
- **`ipc/onboarding/provider.ts:87–89`** — logs provider choice + latency, never API key or model name prefix: `"provider=openrouter modelSet=true latencyMs=..."`
- **`keystore-writer.ts`** — password is never logged (passed to `initializeMasterPassword()`, stays in memory)

**Invariant**: No secret values, lengths, prefixes, or suffixes appear in logs. Only field names and operational metadata.

---

## Capabilities (Stable IDs)

| Capability | Owned By | Purpose |
|---|---|---|
| `CAP-vexapp-docker-probe` | `docker/probe.ts` | Parse versions, probe ports, check Compose floor |
| `CAP-vexapp-docker-install` | `docker/install.ts` | Install Docker (platform-specific) |
| `CAP-vexapp-docker-start` | `docker/start.ts`, `daemon.ts` | Auto-start Docker daemon |
| `CAP-vexapp-docker-endpoint-policy` | `docker/endpoint-policy.ts` | Validate local-only Docker contexts; reject remote |
| `CAP-vexapp-compose-render` | `compose/render.ts` | Render template → `docker-compose.yml` with per-install secrets |
| `CAP-vexapp-compose-up` | `compose/lifecycle.ts` | Run `docker compose up -d` with port conflict detection, health waits |
| `CAP-vexapp-compose-down` | `compose/lifecycle.ts` | Run `docker compose stop` (preserves volumes) |
| `CAP-vexapp-compose-pg-health` | `compose/pg-health.ts` | Validate Postgres readiness |
| `CAP-vexapp-compose-embeddings-health` | `compose/embeddings-health.ts` | Validate embeddings runtime (dimension + endpoint) |
| `CAP-vexapp-onboarding-write-env` | `onboarding/env-write.ts` (via mutex) | Write non-secret `.env` keys under lock |
| `CAP-vexapp-onboarding-write-api-keys` | `ipc/onboarding/api-keys.ts` | Persist API key vault entries |
| `CAP-vexapp-onboarding-write-embedding` | `ipc/onboarding/embedding.ts` | Write 4 EMBEDDING_* env keys |
| `CAP-vexapp-onboarding-write-provider` | `ipc/onboarding/provider.ts` | Verify connection, persist vault secret, reload + reset provider |
| `CAP-vexapp-onboarding-write-keystore` | `ipc/onboarding/keystoreSet` (via `keystore-writer.ts`) | Initialize master password, unlock vault |
| `CAP-vexapp-onboarding-write-wallets` | `ipc/onboarding/wallets.ts` | Generate, import, restore EVM + Solana wallets |
| `CAP-vexapp-onboarding-polymarket-setup` | `ipc/onboarding/polymarket-setup.ts` | Store Polymarket credentials |
| `CAP-vexapp-onboarding-finalize` | `ipc/onboarding/finalize.ts` | Complete setup: validate, backup, flip wizard.completed, apply telemetry |
| `CAP-vexapp-onboarding-env-state` | `onboarding/env-state.ts` | Gather presence-only env state for System Check (non-destructive) |

---

## Public API (Consumed By)

### Renderer Features

- **`docker/` screen** — calls `dockerBootstrap()` → listens to progress bus → renders daemon status, next action, install link
- **`compose/` bootstrap** — calls `getDockerBootstrapState()` → waits for Compose floor, port readiness
- **`database/` System Check** — calls `getEnvState()` → displays Postgres + Embeddings connectivity
- **`wizard/` multi-step** — each step calls its step handler (keystoreSet, apiKeysSet, embeddingConfigure, providerPersist, etc.) → displays success/error with `fieldsWritten` summary

### Main Process (via `ipc/register-all.ts`)

All handlers are registered at app bootstrap. No manual registration by renderer.

---

## Internal Flow

### Docker Bootstrap → Compose Up

```
Renderer: dockerBootstrap() 
  → Main: ensureDockerDaemonReady()
    → checkDockerDaemon() [probe]
    → [if down] performStart() [auto-start, poll readiness]
    → emit progress events
  ← Renderer: displays daemon status + Continue button

Renderer: Continue / Retry
  → Main: composeUp() [triggered by boot-complete signal or explicit IPC]
    → checkComposeFloor() [semver >= 2.23.1]
    → inspectDockerEndpointPolicy() [reject remote]
    → renderCompose() [render template → ${userDataDir}/compose/docker-compose.yml]
    → docker compose up -d
    → waitForHealth(db) [pgConnectProbe]
    → waitForHealth(embeddings) [embeddings-health polling]
    → emit "compose ready" event
  ← Renderer: transition from System Check to Wizard
```

### Wizard Multi-Step

```
For each step (e.g., providerPersist):
  Renderer: ipc/onboarding/provider:providerPersist({ apiKey, model })
    → Main: verifyOpenRouterConnection() [timeout 15s, 16-token test]
    → [if fail] return error immediately (NO .env write)
    → [if ok] withEnvWriteLock(async () => {
        writeProvider() [vault secret + .env non-secret]
        loadProviderDotenv({ overwrite: true })
        resetProvider() [from @vex-agent/inference/registry.js]
      })
    → return { ok: true, fieldsWritten: [...], verifiedLatencyMs }
  ← Renderer: display success + field summary
```

### Finalize

```
Renderer: completeSetup({ telemetryConsent: boolean })
  → Main: finalize()
    1. Validate envState (all required fields present)
    2. autoBackup() [may return null if nothing to backup]
    3. wizardState.update({ completed: true, ... })
    4. [if telemetryConsent] preferencesStore.update + initSentryIfConsented()
    5. fs.writeFile(SETUP_COMPLETE_FILE)
    → return { completedAt, backupPath, telemetryWarning }
  ← Renderer: display completion + next steps
```

---

## Dependencies

### Electron & Node APIs

- `electron` — BrowserWindow (not touched by this module; preload bridges IPC)
- `node:fs`, `node:promises` — read/write files, mkdir recursive, atomic temp+rename
- `node:child_process` — `execFile` via `spawn-runner.ts` for Docker CLI calls
- `node:path` — path manipulation (userDataDir, configDir, relative paths)
- `node:crypto` — randomBytes, base64url encoding (crypto adapter)

### Internal Dependencies

- `@vex-lib/dotenv.js` — `appendMultipleToDotenvFile()`, `stripManagedSecretsFromDotenvFile()`
- `@vex-lib/local-secret-vault.js` — `writeUnlockedSecrets()`, `getUnlockedSecretPresence()`
- `@vex-lib/runtime-env.js` — `loadProviderDotenv({ overwrite })`
- `@vex-lib/wallet-backup.js` — `autoBackup()`
- `@vex-lib/wallet.js` — `loadKeystoreFile()`, `saveKeystoreFile()`, keystore crypto
- `@vex-agent/inference/registry.js` — **`resetProvider()`** (dynamic import on F1)
- `@shared/schemas/*` — Zod schemas for input validation (provider, api-keys, wallets, finalize, etc.)
- `@shared/ipc/channels.js`, `result.js` — IPC channel definitions, error/success wrappers

### External Dependencies (from package.json)

- `zod` — schema validation for external input at IPC boundaries
- `dockerode` — NOT directly used here; spawn-runner uses CLI (for multi-platform portability)

---

## Cross-References

### ADRs & Fixes

- **F1** — Provider reset on persistence (codex turn 2 RED #1). Reset happens inside env-write lock in `provider.ts:70–73`. Required for next `resolveProvider()` to see fresh model.
- **F10** — FIXED (F10-OWASP, commit 1c858ee): keystore + vault scrypt both N=2^17 (131072), OWASP parity. Enforced in `@vex-lib/wallet.ts` (external); this module never touches keystore encryption directly.
- **F13** — Embeddings endpoint. Template hardcodes `:55134` (compose port); legacy `:12434` is status drift only. `embeddings-health.ts` validates on the final published port.

### Project Rules

- **10-engineering-standards.md § 3** — Domain logic (Docker endpoint policy, Compose lifecycle, env-write serialization) modeled explicitly, not loose flags.
- **20-typescript.md § 2** — All external input (IPC payloads, .env files, vault reads) validated with Zod at boundaries.
- **60-security-and-dependencies.md § 2** — Secrets never logged or exposed; vault-backed, password-protected.
- **80-edge-cases.md § 1** — Compose `$VAR` escaping; `$$` required in `configs.content:` script body.

---

## Refresh Triggers

This document is **STALE** if any of these change:

1. **`docker-compose.template.yml`** — service definitions, volumes, image digests, port assignments, $$VAR escaping in init script
2. **`embedding-defaults.ts`** (either main or shared) — EMBEDDING_DIM, port, model alias, digest pins
3. **Compose floor version** — `COMPOSE_VERSION_FLOOR` in `probe.ts`
4. **Provider reload sequence** — call site for `resetProvider()` in `provider.ts`
5. **Finalize ceremony steps** — new validation checks, new telemetry consent logic, backup conditions
6. **Secret storage location** — vault file path, adapter implementations
7. **Wizard state store format** — schema changes, new fields
8. **Endpoint policy rules** — acceptable Docker contexts (`unix://`, `npipe://`, etc.)

---

## Open Questions

### RESOLVED (Confirmed via Code)

- **Q: Does `provider-writer.ts` trigger `resetProvider()`?** ✓ Yes, in `provider.ts` lines 70–73 (dynamic import, called inside env-write lock).
- **Q: Is embedding endpoint `:55134` or `:12434`?** ✓ `:55134` (DEFAULT_EMBED_PORT in embedding-defaults.ts line 20). Template line 126 renders `${VEX_EMBED_PORT:-55134}`.
- **Q: Does `embeddings-health.ts` check dim = 768?** ✓ Yes, lines 177–187 assert `probe.dim === EMBEDDING_DIM` (768).
- **Q: Are all `$VAR` in compose init script properly escaped as `$$VAR`?** ✓ Yes, lines 172–191 use `$$MODEL`, `$$TMP`, `$$ACTUAL`, `$$EXPECTED`, `$$URL`.
- **Q: Does wizard state finalize set a `.setup-complete` marker?** ✓ Yes, `finalize.ts:199` writes `SETUP_COMPLETE_FILE` (mode 0o600).
- **Q: Does provider write store the API key in vault, not `.env`?** ✓ Yes, `provider-writer.ts:61–72` stores key in vault, writes only non-secret env vars to `.env`.
- **Q: Is env-write-mutex poison-free (failures don't block subsequent writes)?** ✓ Yes, `env-write-mutex.ts:49` uses `.catch(() => undefined)` to avoid poisoning.

### UNCERTAIN (Requires Fresh Verification)

- **Compose version detection** — `parseComposeVersion()` regex on line 71–74 of `probe.ts` parses `v?` prefix, `-desktop.N` suffix. Verify this matches Docker Desktop + standalone compose plugin edge cases (e.g., `v2.23.1-desktop.1`, `2.40.0-rc.2`).
- **Postgres health check wait strategy** — template line 44–49 uses `pg_isready` with `retries: 20` and `interval: 5s` (100s wall time, `start_period: 10s`). Confirm this is sufficient for cold-start scenarios (M18+ init overhead).
- **Embeddings model download resumption** — init script (line 183) uses `curl --retry 3 --retry-delay 5`. Verify this is sufficient for intermittent network; no resume (`-C -`) implemented.

---

## Notes

- **Monorepo cross-import**: vex-app's Vite bundler resolves `@vex-lib` via `../src/lib` (monorepo baseline). When Rolldown bundles main, it resolves from the importer's (`/Vex/src/lib/`) directory tree, not vex-app's own node_modules. **CI must `pnpm install` at repo root before vex-app build** (edge-cases rule 4 & 50-containers).
- **Single-flight finalize**: Re-entrant call while finalize is in flight returns the existing promise. Renderer disables the Finalize button on submit; this is defense-in-depth against accidental double-click.
- **Stale bind-mount recovery**: Pre-M7 logic would destructively wipe volumes on any Compose error (assuming fresh install). Post-setup, that's catastrophic. Fail-safe gate: `wizardCompleted !== false` authorizes wipe; unknown state (null) is treated as complete.
- **Env-write vs wallet-write mutexes**: Different domains. Env-write serializes 4 different step handlers (all touch `.env`). Wallet-write serializes generation/import/restore (all touch 3 files + backup). No handler path needs both locks (audited M9 plan).

