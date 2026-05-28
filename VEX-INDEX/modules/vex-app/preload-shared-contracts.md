---
id: module.vex-app.preload-shared-contracts
kind: module
paths:
  - "vex-app/src/preload/**"
  - "vex-app/src/shared/ipc/**"
  - "vex-app/src/shared/schemas/**"
  - "vex-app/src/shared/types/bridge/**"
  - "vex-app/src/shared/types/bridge.ts"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "vex-app/src/preload/**"
  - "vex-app/src/shared/ipc/**"
  - "vex-app/src/shared/schemas/**"
  - "vex-app/src/shared/types/bridge/**"
  - "vex-app/src/shared/types/bridge.ts"
  - "vex-app/src/renderer/vex.d.ts"
  - "vex-app/src/main/ipc/register-handler.ts"
  - "vex-app/src/main/ipc/register-all.ts"
  - "vex-app/src/main/ipc/cancel*.ts"
  - "vex-app/src/main/agent/*-bridge.ts"
  - "vex-app/scripts/check-process-boundaries.mjs"
related:
  - module.vex-app.main-process
  - module.vex-app.renderer-appshell
  - module.vex-agent.engine-runtime-events
---

# vex-app Preload + Shared Contracts

## Purpose

Owns the renderer trust boundary: typed `window.vex` bridge, channel constants, Zod schemas,
Result/Error contracts, cancellation envelopes, and event subscriptions.

## Current inventory

- `preload/index.ts:34` exposes exactly one bridge object with `satisfies VexBridge`.
- Preload surface: 10 shell domains + 13 agent domains.
- `CH`: 93 request constants across 24 request domains, including unbridged/reserved updater constants.
- `EV`: 10 event constants across system/docker/database/updater/engine.
- `VEX_DOMAINS`: 29. `VEX_ERROR_CODES`: 54.
- Preload validates request inputs and subscribed events. Main validates success outputs and malformed error envelopes.

## Important gaps

- F5: `EV.engine.controlState` has a schema and main publisher, but no preload method.
- Runtime bridge methods still return legacy `RuntimeRequestResult` while handlers use per-action schemas.
- Constants without live bridge/handler: `CH.onboarding.providerListModels`, `CH.onboarding.providerTest`, `CH.updater.check`.
- Events not bridged to renderer: `EV.system.*`, `EV.docker.daemonChanged`, `EV.updater.available`, `EV.engine.controlState`.
- Some legacy bridge barrels omit newer domain types; narrow imports currently avoid the issue.

## Refresh triggers

Any change to preload domain files, shared IPC channels/result/schemas/types, main handler registration,
engine bridge publishers, or process-boundary script.
