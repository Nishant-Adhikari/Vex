# Vex Audit Manifest

## 0. Overview & method

### Baseline

- **Repo root:** `/mnt/x/Vex`
- **Branch:** `feat/agent-tool-resolution-safety`
- **Baseline:** current working tree, including uncommitted changes.
- **Mode:** read-only reconnaissance. No files were edited.
- **Scope:** all of `vex-app/` and all of `src/`.

### Measured totals

- **Scoped files:** 1,641 files under `vex-app/` and `src/`
- **Test/spec/e2e files:** 526
- **`console.*` occurrences:** 10 — **0 in production code** (the rest are tests/scripts/logger-config). CORRECTION: the original count of 37 was overstated ~3.7× (verified by exhaustive grep).
- **Source/text LOC:** 249,393
- **Source/text bytes:** 9,260,148
- **All scoped bytes, including assets:** 26,961,172

### Working-tree notes

Current working tree includes substantial in-scope modifications and untracked files, especially around plan/session behavior:

- Modified engine/tool files include:
  - `src/vex-agent/engine/core/run-tool.ts`
  - `src/vex-agent/engine/core/hydrate.ts`
  - `src/vex-agent/engine/core/turn-loop.ts`
  - `src/vex-agent/engine/core/turn-loop-tool-batch.ts`
  - `src/vex-agent/tools/dispatcher.ts`
  - `src/vex-agent/tools/registry.ts`
- Modified app IPC/renderer/shared files include:
  - `vex-app/src/main/ipc/register-all.ts`
  - `vex-app/src/preload/agent/sessions.ts`
  - `vex-app/src/renderer/lib/api/sessions.ts`
  - `vex-app/src/shared/ipc/channels.ts`
  - `vex-app/src/shared/schemas/sessions.ts`
- Untracked in-scope plan/session files include:
  - `src/vex-agent/db/migrations/031_session_plans.sql`
  - `src/vex-agent/db/repos/session-plans.ts`
  - `src/vex-agent/engine/core/turn-loop-plan-acceptance-pause.ts`
  - `src/vex-agent/engine/plan/**`
  - `src/vex-agent/tools/internal/plan/**`
  - `src/vex-agent/tools/registry/plan.ts`
  - `vex-app/src/main/ipc/sessions/plan.ts`
  - `vex-app/src/renderer/features/appShell/SessionPlanCard.tsx`
  - `vex-app/src/shared/schemas/session-plan.ts`

This manifest describes the dirty working tree at audit time, not a committed baseline. CORRECTION: the plan/session files listed above (including `SessionPlanCard.tsx`) are now committed/tracked, not untracked.

### Repo layout

- `vex-app/`: Electron desktop app.
  - `src/main/`: privileged Electron main process. Owns BrowserWindow, custom app protocol, IPC handlers, Docker/Compose lifecycle, local DB connection, secrets, telemetry/support, and agent bridge.
  - `src/preload/`: typed `window.vex` bridge. It is the only renderer bridge and does not expose raw IPC.
  - `src/shared/`: IPC channels, result/error contracts, Zod schemas, bridge types.
  - `src/renderer/`: untrusted React UI for onboarding, app shell, sessions, approvals, runtime, wallets, Docker/DB setup.
  - `resources/compose/`: production and e2e Compose files.
  - `resources/migrations/`: packaged SQL migration mirror.
  - `scripts/`: process-boundary, build-artifact, migration-copy, and package checks.
  - `build/`: Electron fuses and app assets.
  - `e2e/`: Playwright smoke tests.
- `src/`: backend/runtime and protocol clients.
  - `src/vex-agent/engine/`: local agent runtime, turn loop, mission runner, approvals, runtime control, prompts.
  - `src/vex-agent/tools/`: dispatcher, registry, internal tools, protocol runtime, prequote/capture machinery.
  - `src/vex-agent/db/`: Postgres/pgvector migrations and repositories.
  - `src/vex-agent/inference/`: OpenRouter provider, streaming, config, retry/resilience.
  - `src/vex-agent/embeddings/`: embedding provider config and OpenAI-compatible embedding client.
  - `src/vex-agent/knowledge/`, `memory/`, `sync/`: local knowledge/memory and portfolio/projection sync.
  - `src/tools/`: protocol clients and wallet primitives for DexScreener, Khalani, KyberSwap, Polymarket, Jupiter/Solana, Twitter, wallet.
  - `src/lib/`: vault, diagnostics/redaction, DB migrator, wallet/config helpers.
  - `src/config/`: config store and defaults.
  - `src/utils/`: HTTP, dotenv, logger, validation, shims.
  - `src/__tests__/`: backend/runtime/tool tests.

### Method

This manifest combines:

- Local inventory and grep pass.
- Five read-only Explore-agent reports:
  - Electron shell, BrowserWindow, protocol, permissions, IPC/preload.
  - Renderer architecture and UX/security surface.
  - Docker/local services, Compose, DB orchestration, build/signing/updater.
  - Engine/runtime, tools, approvals, policy, wallet/RPC/blockchain.
  - DB/inference/embeddings/knowledge/memory/sync plus protocol clients.
- Vex project rules and skills:
  - `AGENTS.md`
  - `vex-project-rules`
  - `vex-master-router`
  - `vex-platform-architecture`
  - `vex-process-boundaries`
  - `vex-electron-security`
  - `vex-ipc-contracts`
  - `vex-renderer-frontend`
  - `vex-ui-ux-quality`
  - `vex-local-services-docker`
  - `vex-postgres-pgvector`
  - `vex-agent-policy`
  - `vex-provider-hot-wallet`
  - `vex-observability-telemetry`
  - `vex-performance-cleanup`
  - `vex-testing-quality-gates`
  - `vex-build-signing-updater`
  - `vex-user-triggered-updates`
  - `vex-cross-platform-packaging`
  - `vex-release-operations`

### Trust-boundary chain

Canonical trust chain:

```text
renderer UI
  -> preload typed bridge
  -> Electron main IPC handlers
  -> src/vex-agent local runtime
  -> wallet resolution / approval runtime / protocol runtime
  -> external API, EVM RPC, Solana RPC, local DB, Docker services
```

Core posture:

- Renderer is untrusted UI.
- Preload is a narrow typed bridge, not an IPC tunnel.
- Main owns local privilege.
- Shared contracts and Zod validation own boundary safety.
- `src/vex-agent` owns backend/runtime authority.
- Wallet/signing authority must stay behind runtime policy and approval gates.
- Provider hot-wallet private keys must never ship in Electron.
- Docker is mandatory for production users but must not be silently installed or reconfigured.
- Updates must be user-triggered; no silent production auto-download or auto-install.
- Secrets must never appear in renderer state, logs, telemetry, local storage, app resources, or support bundles.

