---
id: module.src-root.lib-env-config
kind: module
paths:
  - "src/lib/dotenv.ts"
  - "src/lib/agent-config.ts"
  - "src/lib/runtime-env.ts"
  - "src/lib/env.ts"
  - "src/lib/embedding.ts"
  - "src/lib/embedding-constants.ts"
  - "src/lib/openrouter-client.ts"
  - "src/providers/env-resolution.ts"
  - "src/config/paths.ts"
  - "src/config/store.ts"
  - "src/utils/dotenv.ts"
  - "src/utils/env.ts"
  - "src/constants/chain.ts"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/lib/dotenv.ts"
  - "src/lib/agent-config.ts"
  - "src/lib/runtime-env.ts"
  - "src/lib/env.ts"
  - "src/lib/embedding.ts"
  - "src/lib/embedding-constants.ts"
  - "src/lib/openrouter-client.ts"
  - "src/providers/env-resolution.ts"
  - "src/config/paths.ts"
  - "src/config/store.ts"
  - "src/utils/dotenv.ts"
  - "src/utils/env.ts"
  - "src/constants/chain.ts"
  - "vex-app/src/main/index.ts"
  - "vex-app/src/main/ipc/onboarding/provider.ts"
  - "src/lib/secret-keys.ts"
related:
  - module.src-root.lib-vault-secrets
  - module.src-root.lib-wallet
  - module.vex-agent.inference
  - fix-plan.F1
  - ADR-0001-global-model-session-wallet
---

# src-root / lib-env-config

## Purpose

Env loading, non-secret config persistence, agent/embedding tuning metadata, and chain defaults
for the Vex monorepo. This module is the foundation for every part of the app that reads
`AGENT_*`, `SUBAGENT_*`, or `EMBEDDING_*` env variables, writes or reads `${CONFIG_DIR}/.env`,
or needs the platform-specific config directory path. It supplies three classes of consumers:
the engine (reads `process.env` only, never loads files itself), the Electron main process
(owns env injection, config writes, and SDK access), and the renderer (pure metadata: field
bounds and constants only, no FS access).

## Retrieval keywords

- dotenv, .env, env file, CONFIG_DIR, config dir resolver
- AGENT_MODEL, AGENT_PROVIDER, AGENT_CONTEXT_LIMIT, AGENT_MAX_OUTPUT_TOKENS, AGENT_TEMPERATURE
- SUBAGENT_*, parseAgentEnv, parseSubagentEnv, loadProviderDotenv, loadDotenvFileIntoProcess
- appendToDotenvFile, appendMultipleToDotenvFile, removeFromDotenvFile, readDotenvFileValue
- runtime-env, overwrite semantics, load-if-undefined, managed secrets skip
- embedding defaults, embedding constants, EMBEDDING_DIM, MIN/MAX_EMBEDDING_DIM
- openrouter-client, OpenRouter SDK re-export, instanceof checks, SDK error classes
- env-key constants, TRACKED_API_KEYS, legacy/env drift candidates
- config.json, VexConfig, saveConfig, loadConfig, saveConfigPatch, isValidWalletId
- master password env, VEX_KEYSTORE_PASSWORD, getKeystorePassword, requireKeystorePassword
- CHAIN, Ethereum Mainnet, chain defaults, ERC20_ABI
- F1 fix, boot env load, post-onboarding reload, overwrite reload

## State owned

### Filesystem

| File | Description |
|------|-------------|
| `${CONFIG_DIR}/.env` | Non-secret runtime config: `AGENT_*`, `SUBAGENT_*`, `EMBEDDING_*`. Written atomically (temp+rename, mode 0o600). Never contains `MANAGED_SECRET_ENV_KEYS`. |
| `${CONFIG_DIR}/config.json` | Public wallet addresses, chain/RPC/service URLs. No secrets, no private keys. Written atomically (temp+rename). |

### Environment variables consumed

| Variable | Source | Load path |
|---|---|---|
| `AGENT_MODEL` | `.env` | `loadProviderDotenv()` at boot + `loadProviderDotenv({overwrite:true})` post-onboarding |
| `AGENT_PROVIDER` | `.env` | Same as above |
| `AGENT_CONTEXT_LIMIT` | `.env` | Same |
| `AGENT_MAX_OUTPUT_TOKENS` | `.env` | Same |
| `AGENT_TEMPERATURE` | `.env` | Same |
| `SUBAGENT_*` | `.env` | Same |
| `EMBEDDING_*` | `.env` | Same |
| `VEX_KEYSTORE_PASSWORD` | injected by vault-unlock flow, never `.env` | `getKeystorePassword()` reads `process.env` only |
| `VEX_CONFIG_DIR` | shell/CI override | Consumed by `getConfigDir()` in `paths.ts`; must be non-empty AND absolute |

`MANAGED_SECRET_ENV_KEYS` (`OPENROUTER_API_KEY`, `JUPITER_API_KEY`, `TAVILY_API_KEY`,
`RETTIWT_API_KEY`, `POLYMARKET_*`, `VEX_KEYSTORE_PASSWORD`) are NEVER loaded from `.env`
by this module. The `shouldLoadKey` predicate in `loadProviderDotenv` calls
`isManagedSecretEnvKey` and returns false for them.

## Boundary crossings

- **Filesystem (read+write)**: `utils/dotenv.ts` reads/writes `${CONFIG_DIR}/.env`;
  `config/store.ts` reads/writes `${CONFIG_DIR}/config.json`. Both use atomic temp+rename.
- **`process.env` (write)**: `loadDotenvFileIntoProcess` is the only function that mutates
  `process.env` in this module. Called from `loadProviderDotenv` only. The engine never
  writes `process.env` itself; this is a main-process privilege.
- **Filesystem (read-only)**: `embedding.ts` reads a `.env.example` file at a path the
  caller provides (main process only). Missing-file safe (returns `{ok:false, reason:"file_missing"}`).
- **No network, no DB, no IPC, no Electron APIs**. Every file in scope is pure Node.js.
  `chain.ts`, `embedding-constants.ts`, `agent-config.ts` have zero I/O (renderer-safe).
- **`@openrouter/sdk`**: `openrouter-client.ts` re-exports SDK classes for runtime `instanceof`
  checks in `vex-app/src/main/onboarding/openrouter-test-client.ts`. Requires the SDK at
  runtime — must not be imported from renderer.

## File map

- `src/utils/dotenv.ts` — **atomic dotenv primitives** (no imports outside `node:fs`/`node:path`):
  - `:4 readDotenvFileValue(key, envPath)` — single-key reader; handles double-quoted values.
  - `:31 loadDotenvFileIntoProcess(envPath, options)` — loads `.env` into `process.env`. Key behavior:
    - `overwrite: false` (default) → **load-if-undefined**: skips keys already in `process.env`. Shell env wins at boot.
    - `overwrite: true` → **unconditional set**: used post-onboarding write so new value is live without restart.
    - Missing file → silent no-op.
    - `shouldLoadKey` predicate → used by `loadProviderDotenv` to skip managed secrets.
  - `:64 appendToDotenvFile(key, value, envPath)` — single-key atomic upsert; creates dir if needed; mode 0o600.
  - `:102 removeFromDotenvFile(key, envPath)` — atomic delete; idempotent; used by agent-core-writer "reset to default".
  - `:143 appendMultipleToDotenvFile(updates, envPath)` — **multi-key atomic update** (M11): single read → strip all existing occurrences → append canonical values → temp+rename; `null` value = delete key. Prevents stale-key drift.

- `src/providers/env-resolution.ts` — **provider-neutral env resolution**:
  - `:25 readEnvValue(key, envPath)` — routes managed secrets to `process.env`, others to file.
  - `:37 loadProviderDotenv(options?)` — loads `ENV_FILE` skipping `MANAGED_SECRET_ENV_KEYS`. **Central F1 fix entry point.** Accepts `{overwrite?: boolean}`, passes through to `loadDotenvFileIntoProcess`.
  - `:44 writeAppEnvValue(key, value)` — guards against writing managed secrets to `.env`; strips managed keys from file on every write (defense-in-depth).
  - Imports `ENV_FILE` from `config/paths.ts` and `isManagedSecretEnvKey` from `lib/secret-keys.ts`.

- `src/lib/runtime-env.ts` — **`@vex-lib/runtime-env.js` facade** (added by F1, commit `97c2c9c`):
  - `:14 export { loadProviderDotenv }` — single re-export from `providers/env-resolution.ts`.
  - Exists because vex-app main has no `@providers` alias; only `@vex-lib`, `@vex-agent`, `@tools`, `@utils`, `@config`. Follows the established lib facade pattern (`dotenv.ts`, `wallet.ts`).

- `src/lib/dotenv.ts` — **`@vex-lib/dotenv.js` facade**:
  - Re-exports `appendMultipleToDotenvFile`, `appendToDotenvFile`, `loadDotenvFileIntoProcess`, `readDotenvFileValue`, `removeFromDotenvFile` from `utils/dotenv.ts`.
  - Used by: `provider-writer.ts`, `embedding-writer.ts`, `agent-core-writer.ts`, `ensure-embedding-defaults.ts`, `embedding-state.ts`.

- `src/lib/agent-config.ts` — **AGENT_*/SUBAGENT_* field metadata + parse pipeline** (M9):
  - Pure module. No fs/DB/Electron. Safe to import from renderer and shared.
  - Field constants: `AGENT_CONTEXT_LIMIT` (128k default, 1k–2M), `AGENT_MAX_OUTPUT_TOKENS` (16384 default, 256–128k), `AGENT_TEMPERATURE` (null default, 0–2), plus 6 `SUBAGENT_*` fields.
  - `SUBAGENT_MAX_OUTPUT_TOKENS` and `SUBAGENT_TEMPERATURE` use `fallbackFrom` pointing to their agent counterparts.
  - `:165 parseAgentEnv(env)` — returns `{value: AgentEffective, errors: ParseError[]}`. Invalid values → error entry + field default used. Non-finite or out-of-range → pushed error.
  - `:180 parseSubagentEnv(env, agentEff)` — uses agent effective values as fallback for `SUBAGENT_MAX_OUTPUT_TOKENS` and `SUBAGENT_TEMPERATURE`.
  - `:263 formatParseErrors(prefix, errors)` — formats error array for logging/throwing.
  - Dual consumer contract: engine (`inference/config.ts`) THROWS on `AGENT_*` parse errors; vex-app main (`agent-core-writer.ts`) uses the same parse to block writes at the write boundary.

- `src/lib/embedding.ts` — **embedding defaults reader** (`@vex-lib/embedding.js`):
  - Imports `readFileSync` from `node:fs` — NOT renderer-safe. Main process only.
  - Re-exports `MIN_EMBEDDING_DIM`, `MAX_EMBEDDING_DIM` from `embedding-constants.ts`.
  - `:61 readEmbeddingDefaultsFromExample(envExamplePath)` — parses a `.env.example`-style file for `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `EMBEDDING_PROVIDER`. Strict integer-only parse for `EMBEDDING_DIM`; range validates against bounds. Returns discriminated `EmbeddingDefaultsResult`.

- `src/lib/embedding-constants.ts` — **embedding range constants** (`@vex-lib/embedding-constants.js`):
  - Pure, zero imports. `MIN_EMBEDDING_DIM = 1`, `MAX_EMBEDDING_DIM = 8192`.
  - Split from `embedding.ts` so renderer (`EmbeddingStep.tsx`) and shared schemas can import bounds without pulling `node:fs` transitively.

- `src/lib/openrouter-client.ts` — **`@vex-lib/openrouter-client.js` facade** (M10):
  - Re-exports `OpenRouter` class + 5 HTTP error classes from `@openrouter/sdk` as runtime values (not `export type`) — required for `instanceof` checks in `mapSdkError`.
  - Avoids importing engine's `OpenRouterProvider` (which pulls `loadEnvConfig`, `@utils/logger`, engine deps). Exists only for `vex-app/src/main/onboarding/openrouter-test-client.ts`.

- `src/config/paths.ts` — **engine-side config dir resolver**:
  - `:6 getConfigDir()` — platform-specific resolver: `%APPDATA%/vex` (win32), `~/Library/Application Support/vex` (darwin), `~/.config/vex` (linux). Honors `VEX_CONFIG_DIR` env override (must be non-empty AND absolute).
  - `:39 CONFIG_DIR` — computed once at module load.
  - Exports: `CONFIG_FILE`, `KEYSTORE_FILE`, `SOLANA_KEYSTORE_FILE`, `INTENTS_DIR`, `JWT_FILE`, `ENV_FILE`, `SECRETS_VAULT_FILE`, `BACKUPS_DIR`, `BOT_*`, `LAUNCHER_*`, `CONNECTORS_DIR`, `SOLANA_TOKEN_CACHE_FILE`.
  - Consumed by: `providers/env-resolution.ts`, `lib/wallet.ts`, `lib/local-secret-vault.ts`, `tools/wallet/*`, `tools/solana-ecosystem/*`, `tools/polymarket/*`, `tools/dexscreener/*`.

- `src/config/store.ts` — **`config.json` public config** (chain/RPC/services/wallet inventory):
  - `:36 isValidWalletId(family, id, legacy)` — **path-traversal guard**: non-legacy id must be `<prefix>_<uuid>`. Guards `derivePath` in `tools/wallet/inventory.ts`.
  - `:226 loadConfig()` — reads + deep-merges with `getDefaultConfig()`; normalizes wallet section (new array shape OR legacy single-address shape → synthesized `*_legacy` entries). Malformed array entries dropped with warning (not thrown), so a corrupt row cannot brick startup.
  - `:276 saveConfig(config)` — atomic temp+rename write.
  - `:300 configExists()` — existence check.
  - `:332 saveConfigPatch(patch)` — partial section update: load → merge → save. Returns persisted config.
  - `VexConfig` contains optional `claude?: {provider, model, providerEndpoint, proxyPort}` field — this is a legacy/MCP-era remnant; NOT used for agent inference (model is `AGENT_MODEL` in `.env`, not here). **Not to be confused with the global model config.**
  - Imports `CHAIN` from `constants/chain.ts` for `getDefaultConfig()`.

- `src/utils/env.ts` — **master password env getter**:
  - `:18 getKeystorePassword()` — reads `process.env[VEX_KEYSTORE_PASSWORD]`; sanitizes empty/"undefined".
  - `:26 requireKeystorePassword()` — throws `VexError(KEYSTORE_PASSWORD_NOT_SET)` if absent.
  - Used by wallet decryption flows, not by env-loading flows.

- `src/constants/chain.ts` — **Ethereum Mainnet defaults**:
  - `CHAIN` const: chainId=1, name="Ethereum Mainnet", rpc/explorer/nativeCurrency.
  - `ERC20_ABI`: minimal ABI (balanceOf, symbol, decimals, transfer).
  - Pure module; consumed by `config/store.ts` `getDefaultConfig()`.

## Key types & invariants

- `LoadDotenvOptions` (`utils/dotenv.ts:20`) — `{shouldLoadKey?, overwrite?}`. `overwrite` defaults false → **load-if-undefined is the safe default**; shell/test-provided env wins at boot. `overwrite: true` is only used in the post-onboarding write path.

- `AgentEffective` (`agent-config.ts:143`) — `{contextLimit: number, maxOutputTokens: number, temperature: number|null}`. Always has numeric values; invalid/absent env vars fall back to field defaults. **Invariant: engine never sees a missing contextLimit — it always has the compile-time default 128k even when `.env` was never loaded.**

- `SubagentEffective` (`agent-config.ts:149`) — mirrors `AgentEffective` plus `maxConcurrent`, `maxIterations`, `timeoutMs`. Fallback chain: valid `SUBAGENT_*` value → agent effective value → field default.

- `EmbeddingDefaultsResult` (`embedding.ts:34`) — discriminated union: `{ok:true, values}` or `{ok:false, reason, detail?}`. `reason` values: `file_missing` (any read error), `parse_error` (bad dim), `incomplete` (missing keys). **Caller at UI layer need not distinguish ENOENT from EACCES.**

- `VexConfig` (`config/store.ts:54`) — `version: 1` guard on load. The `claude?` field is a legacy remnant from MCP-era; it does NOT govern inference model (see ADR-0001). Agent model lives in `.env`, not `config.json`.

- `WalletInventoryEntry` + `isValidWalletId` invariant (`config/store.ts:17,36`): non-legacy id must match `<family-prefix>_<uuid>`. This prevents path traversal in `tools/wallet/inventory.ts:derivePath`. Malformed or cross-family ids are dropped on load.

- **Managed-secrets skip invariant** (`env-resolution.ts:39`): `loadProviderDotenv` NEVER sets a `MANAGED_SECRET_ENV_KEYS` key in `process.env`. Vault secrets remain vault-only. This makes the ordering of `loadProviderDotenv()` relative to `applySecretVaultToProcessEnv()` irrelevant for security.

## Capabilities (stable IDs)

- **CAP-env-config-load-dotenv-boot**: Load non-secret `.env` into `process.env` at vex-app main boot (load-if-undefined; shell env wins) — `vex-app/src/main/index.ts:116 loadProviderDotenv()`; implementation at `src/providers/env-resolution.ts:37 loadProviderDotenv`; primitive at `src/utils/dotenv.ts:31 loadDotenvFileIntoProcess`.

- **CAP-env-config-reload-post-onboarding**: Reload non-secret `.env` with overwrite after provider onboarding write, then invalidate engine provider cache — `vex-app/src/main/ipc/onboarding/provider.ts:69 loadProviderDotenv({overwrite:true})` + `:70-73 resetProvider()`. This is the F1 same-session reconfigure correctness path.

- **CAP-env-config-write-dotenv-atomic**: Atomically write/update one or more keys in `.env` (temp+rename, mode 0o600) — `src/utils/dotenv.ts:64 appendToDotenvFile` (single key) and `:143 appendMultipleToDotenvFile` (multi-key, null=delete).

- **CAP-env-config-parse-agent**: Parse `AGENT_*` env vars into validated effective values with defaults — `src/lib/agent-config.ts:165 parseAgentEnv`.

- **CAP-env-config-parse-subagent**: Parse `SUBAGENT_*` env vars with agent-effective fallback — `src/lib/agent-config.ts:180 parseSubagentEnv`.

- **CAP-env-config-resolve-config-dir**: Resolve platform-specific `CONFIG_DIR` with `VEX_CONFIG_DIR` test override — `src/config/paths.ts:6 getConfigDir` (engine) and `vex-app/src/main/paths/config-dir.ts:23 resolveConfigDir` (Electron main). **Duplicated intentionally; see Boundary crossings.**

- **CAP-env-config-read-embedding-defaults**: Parse EMBEDDING_* values from a `.env.example` file — `src/lib/embedding.ts:61 readEmbeddingDefaultsFromExample`.

- **CAP-env-config-embedding-bounds**: Export MIN/MAX EMBEDDING_DIM constants for renderer + shared schemas — `src/lib/embedding-constants.ts:11 MIN_EMBEDDING_DIM`, `:12 MAX_EMBEDDING_DIM`.

- **CAP-env-config-sdk-reexport**: Re-export `@openrouter/sdk` runtime values for `instanceof` checks — `src/lib/openrouter-client.ts:17 OpenRouter + error classes`.

- **CAP-env-config-public-config-load**: Load `config.json` with defaults and legacy wallet normalization — `src/config/store.ts:226 loadConfig`.

- **CAP-env-config-public-config-save**: Atomically save/patch `config.json` — `src/config/store.ts:276 saveConfig`, `:332 saveConfigPatch`.

- **CAP-env-config-wallet-id-guard**: Validate wallet id to prevent path-traversal in keystore derivation — `src/config/store.ts:36 isValidWalletId`.

- **CAP-env-config-master-password-read**: Read master password from `process.env` only (never file) — `src/utils/env.ts:18 getKeystorePassword`, `:26 requireKeystorePassword`.

- **CAP-env-config-chain-defaults**: Supply Ethereum Mainnet defaults for `config.json` and ERC20 ABI — `src/constants/chain.ts:1 CHAIN`, `:13 ERC20_ABI`.

## Public API (consumed by)

### vex-app main process (via `@vex-lib/*`)

| Consumer | Import | Entry point |
|---|---|---|
| `vex-app/src/main/index.ts:20,116` | `@vex-lib/runtime-env.js` | `loadProviderDotenv()` — boot env load (F1) |
| `vex-app/src/main/ipc/onboarding/provider.ts:34,69` | `@vex-lib/runtime-env.js` | `loadProviderDotenv({overwrite:true})` — post-write reload (F1) |
| `vex-app/src/main/onboarding/provider-writer.ts:19` | `@vex-lib/dotenv.js` | `appendMultipleToDotenvFile` |
| `vex-app/src/main/onboarding/embedding-writer.ts:28` | `@vex-lib/dotenv.js` | `appendToDotenvFile`, `readDotenvFileValue` |
| `vex-app/src/main/onboarding/agent-core-writer.ts:38,51` | `@vex-lib/dotenv.js`, `@vex-lib/agent-config.js` | `appendMultipleToDotenvFile`, `removeFromDotenvFile`, `parseAgentEnv`, field constants |
| `vex-app/src/main/onboarding/ensure-embedding-defaults.ts:33` | `@vex-lib/dotenv.js` | `appendToDotenvFile`, `readDotenvFileValue` |
| `vex-app/src/main/onboarding/embedding-state.ts:18,19` | `@vex-lib/embedding.js`, `@vex-lib/dotenv.js` | `readEmbeddingDefaultsFromExample`, `readDotenvFileValue` |
| `vex-app/src/main/onboarding/openrouter-test-client.ts:40` | `@vex-lib/openrouter-client.js` | `OpenRouter`, SDK error classes |
| `vex-app/src/main/ipc/usage.ts:20` | `@vex-lib/agent-config.js` | `AGENT_CONTEXT_LIMIT`, `parseAgentEnv` |
| `vex-app/src/main/paths/config-dir.ts` | (mirrors, does not import) | `CONFIG_DIR` resolver — see Boundary crossings |

### vex-app shared / renderer (via `@vex-lib/*` — pure-only)

| Consumer | Import | Entry point |
|---|---|---|
| `vex-app/src/shared/schemas/embedding.ts:14` | `@vex-lib/embedding-constants.js` | `MIN_EMBEDDING_DIM`, `MAX_EMBEDDING_DIM` |
| `vex-app/src/shared/schemas/agent-core.ts:31` | `@vex-lib/agent-config.js` | Field constants + parse types |
| `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx:42` | `@vex-lib/embedding-constants.js` | `MIN/MAX_EMBEDDING_DIM` |
| `vex-app/src/renderer/features/wizard/steps/AgentCoreStep.tsx:35` | `@vex-lib/agent-config.js` | `AGENT_CONTEXT_LIMIT`, `SUBAGENT_CONTEXT_LIMIT`, field constants |

### src/vex-agent (via root aliases and relative imports — engine only)

| Consumer | Import | Entry point |
|---|---|---|
| `src/vex-agent/inference/config.ts` | `src/lib/agent-config.ts` (relative import in current code) | `parseAgentEnv`, `parseSubagentEnv`, `formatParseErrors`, field constants |
| `src/vex-agent/tools/internal/subagent/parent.ts:10` | inference config | `loadEnvConfig`, `loadSubagentConfig` |

### src/tools and src/lib (direct relative imports)

Wallet tools, protocol clients, and `lib/local-secret-vault.ts` consume `config/paths.ts` and
`config/store.ts` via direct relative imports. These callers are in Z5 and are not vex-app consumers.

## Internal flow

### F1: Boot env load

1. `vex-app/src/main/index.ts` `whenReady` callback enters (line 109).
2. `loadProviderDotenv()` called at line 116 (before `registerAllIpcHandlers` and `setupCompactWorker`).
3. `loadProviderDotenv` → `loadDotenvFileIntoProcess(ENV_FILE, {shouldLoadKey: !isManagedSecretEnvKey, overwrite: false})`.
4. If `${CONFIG_DIR}/.env` exists: each non-managed-secret key present in the file is set in `process.env` ONLY IF not already defined there (shell/test env wins).
5. If `.env` missing (first-ever launch, pre-onboarding): silent no-op. App functions without `AGENT_MODEL` — inference will fail gracefully.
6. Log line `"[main] loaded non-secret runtime config from .env"` written.
7. Engine calls later in the session see `AGENT_MODEL`, `AGENT_PROVIDER`, etc. in `process.env`. **This is the F1 fix.**

### F1: Post-onboarding same-session reconfigure (provider step)

1. Wizard submits provider form → `vex-app/src/main/ipc/onboarding/provider.ts` IPC handler fires.
2. `verifyOpenRouterConnection` runs (16-token probe, 15s timeout). If fails → return error, NO file writes.
3. Inside `withEnvWriteLock`:
   a. `writeProvider(input)` → vault-writes `OPENROUTER_API_KEY`; `appendMultipleToDotenvFile({AGENT_MODEL, AGENT_PROVIDER}, ENV_FILE)`.
   b. On success: `loadProviderDotenv({overwrite: true})` → overwrites `AGENT_MODEL`/`AGENT_PROVIDER` in `process.env` with values just written.
   c. `resetProvider()` (dynamic import `@vex-agent/inference/registry.js`) → bumps generation, clears `cachedProvider`. Next `resolveProvider()` rebuilds with new model/key.
4. **Order invariant**: verify → write → reload → reset. Reload alone would leave the cached `OpenRouterProvider` holding the old model. `resetProvider` without reload is safe but requires restart. Both together ensure same-session correctness.
5. `OPENROUTER_API_KEY` is vault-written by `writeProvider` and injected to `process.env` by the subsequent `applySecretVaultToProcessEnv` on vault-unlock; `loadProviderDotenv` skips it.

### Dotenv file write (atomic)

1. Caller invokes `appendMultipleToDotenvFile(updates, ENV_FILE)`.
2. Read existing content (or empty string if file absent).
3. Strip ALL existing occurrences of every key in `updates` via global regex. Handles duplicate lines from manual edits.
4. Null values in `updates` are intentionally not rewritten (key removal).
5. Append non-null values with canonical quoting (`"value"`).
6. Write to a temp file (`.env.tmp.<timestamp>`, mode 0o600) → `renameSync` (atomic on POSIX; near-atomic on Windows).

### Config dir resolution

The engine resolves `CONFIG_DIR` once at module load (`src/config/paths.ts:39`). The Electron
main process resolves it separately via `vex-app/src/main/paths/config-dir.ts:56`. Both follow
identical logic for `VEX_CONFIG_DIR`, platform, and env variables. The paths they produce MUST
agree; a divergence would cause `.env` writes (from main) and `.env` reads (by the engine) to
target different directories. The comment in `config-dir.ts` explicitly acknowledges this.

## Dependencies

- **Imports FROM**:
  - `src/lib/secret-keys.ts` — `MANAGED_SECRET_ENV_KEYS`, `isManagedSecretEnvKey` (used by `env-resolution.ts`)
  - `src/errors.ts` — `VexError`, `ErrorCodes` (used by `utils/env.ts`)
  - `node:fs`, `node:path`, `node:os` — standard Node (no npm packages except in `openrouter-client.ts`)
  - `@openrouter/sdk` — SDK (via `openrouter-client.ts` only)
  - `zod` — for `config/store.ts` wallet entry validation
  - `src/utils/logger-shim.ts` — minimal logger shim in `config/store.ts`
  - `src/constants/chain.ts` — Ethereum defaults (consumed by `config/store.ts`)
- **Consumed BY** (in-tree, non-test):
  - `src/providers/env-resolution.ts` → all dotenv primitives
  - `src/lib/local-secret-vault.ts` → `ENV_FILE`, `SECRETS_VAULT_FILE` from `config/paths.ts`
  - `src/lib/wallet.ts` → `config/store.ts` + `config/paths.ts`
  - `src/vex-agent/inference/config.ts` → `src/lib/agent-config.ts`
  - `src/vex-agent/tools/internal/subagent/parent.ts` → inference config (which imports agent-config)
  - `src/tools/wallet/*`, `src/tools/solana-ecosystem/*`, `src/tools/polymarket/*`, `src/tools/dexscreener/*` → `config/paths.ts`, `config/store.ts`
  - `vex-app/src/main/*` → via `@vex-lib/*` aliases (see Public API)

## Boundary crossings (notable)

### Config-dir resolver duplication

`src/config/paths.ts` and `vex-app/src/main/paths/config-dir.ts` are **deliberately duplicated**
rather than shared via `@vex-lib`. The reason (stated in Structure.md §0): the Electron module
adds `ELECTRON_STATE_DIR` and other Electron-private paths not relevant to the engine. The engine
resolver is consumed by the engine and CLI scripts; the Electron resolver is consumed by vex-app
main. Both must produce the same `CONFIG_DIR` for the shared `.env`, `config.json`, and keystore
files to land in the same directory.

**Risk**: a future change to `VEX_CONFIG_DIR` handling, platform detection, or `APP_NAME` in one
copy but not the other would silently break the contract. The duplication is intentional but
requires vigilance. There are no automated tests asserting both resolvers produce the same path
for the same inputs.

### Renderer import boundary

`embedding-constants.ts` and `agent-config.ts` are the ONLY files in this module that may be
imported from the renderer (zero I/O, no Node-only APIs). Everything else (`dotenv.ts`,
`runtime-env.ts`, `embedding.ts`, `openrouter-client.ts`, `config/store.ts`, `config/paths.ts`,
`utils/env.ts`) is main-process-only. Importing `embedding.ts` (not `embedding-constants.ts`)
from renderer would pull `node:fs` transitively — the split was specifically created to prevent
this.

### `readEnvValue` routing

`providers/env-resolution.ts:25 readEnvValue` routes `MANAGED_SECRET_ENV_KEYS` to `process.env`
and others to the `.env` file. This routing is used by `vex-app/src/main/onboarding/provider-state.ts`
to read `AGENT_MODEL` and `AGENT_PROVIDER` from the file (not from `process.env`) for the
onboarding step-state check. This is correct for that context but means `AGENT_MODEL` returned
by `readEnvValue` may differ from `process.env.AGENT_MODEL` if the boot load has not happened
or if the file was written after the last `loadProviderDotenv` call.

## Cross-references

- **Fix plan F1**: `fix-plans/F1-model-provider-env.md` — the canonical reference for why `loadProviderDotenv` is called at boot and post-onboarding. F1 confirmed fix landed in commit `97c2c9c`. Boot call: `vex-app/src/main/index.ts:116`. Post-write call: `vex-app/src/main/ipc/onboarding/provider.ts:69`. `src/lib/runtime-env.ts` is the facade added by F1.
- **ADR-0001**: `decisions/ADR-0001-global-model-session-wallet.md` — model is GLOBAL (`AGENT_MODEL` in `.env`). The `claude?` field in `VexConfig` is a legacy remnant and does NOT govern inference.
- **Related module**: `module.src-root.lib-vault-secrets` — vault manages `MANAGED_SECRET_ENV_KEYS`; this module explicitly skips them.
- **Related module**: `module.src-root.lib-wallet` — wallet tools consume `config/paths.ts` and `config/store.ts` from this module.
- **Related module**: `module.vex-agent.inference` — the engine consumer of `agent-config.ts`; `loadEnvConfig` in inference reads `process.env` populated by this module.
- **vex-app coverage**: `audits/current/coverage-gaps.md#CAP-env-config-load-dotenv-boot`
- **quality findings**: `audits/current/quality-findings.md` (no open findings for this module at time of indexing)

## Refresh triggers

- Any file in scope (see `stale_when_paths_change` front matter).
- `src/lib/secret-keys.ts` — changes to `MANAGED_SECRET_ENV_KEYS` directly affect the skip predicate in `loadProviderDotenv`. If a key is removed from the managed set it could start loading from `.env`; if added, it will be blocked.
- `vex-app/src/main/index.ts` — boot sequence change could shift when `loadProviderDotenv()` runs relative to IPC handler registration.
- `vex-app/src/main/ipc/onboarding/provider.ts` — any change to the verify→write→reload→reset ordering breaks same-session reconfigure correctness.
- `vex-app/src/main/paths/config-dir.ts` — must stay in sync with `src/config/paths.ts` platform logic and `APP_NAME`.

## Open questions

1. **Config-dir resolver test gap**: There is no test that asserts `src/config/paths.ts:getConfigDir()` and `vex-app/src/main/paths/config-dir.ts:resolveConfigDir()` produce the same output for identical inputs. A divergence would cause silent data-dir split. A parameterized shared test would close this.

2. **Agent-core/embedding post-write reload**: The F1 fix plan deferred same-session liveness for `agent-core-writer` (context limit, temperature) and `embedding-writer` — only the provider writer calls `loadProviderDotenv({overwrite:true})`. If a user reconfigures context limit mid-session it will not take effect until restart. The fix plan notes this is out of scope; revisit if reported as a UX issue.

3. **`config.json` `claude?` field**: `VexConfig.claude` stores `{provider, model, providerEndpoint, proxyPort}`. This appears to be a legacy MCP-era field. It is NOT referenced by inference and NOT written by the onboarding wizard. Should be considered for removal if it carries no current function — retaining it risks future confusion with the `AGENT_MODEL`/`.env` path.

4. **`appendToDotenvFile` vs `appendMultipleToDotenvFile` consistency**: `appendToDotenvFile` uses a read-test-replace-or-append pattern that does NOT strip duplicate lines (unlike the multi-key variant). A file with duplicate lines (e.g., from manual editing) could cause `loadDotenvFileIntoProcess` to see the FIRST occurrence (first-match-wins). Embedding and ensure-embedding-defaults still use the single-key variant. This is a low-risk latent inconsistency.
