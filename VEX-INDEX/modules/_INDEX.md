---
id: index.modules
kind: module-index
paths: ["VEX-INDEX/modules/**/*.md"]
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change: ["VEX-INDEX/MANIFEST.yml", "VEX-INDEX/modules/**/*.md"]
related: [index.manifest, index.structure]
---

# VEX-INDEX Module Listing

Terse retrieval map for future LLM sessions. `MANIFEST.yml` remains the machine-readable source of truth.

## src/vex-agent (Round 1)

- `module.vex-agent.engine-core` — `modules/vex-agent/engine-core.md`
- `module.vex-agent.engine-runner` — `modules/vex-agent/engine-runner.md`
- `module.vex-agent.engine-runtime-events` — `modules/vex-agent/engine-runtime-events.md`
- `module.vex-agent.engine-mission` — `modules/vex-agent/engine-mission.md`
- `module.vex-agent.engine-wake-subagents-prompts` — `modules/vex-agent/engine-wake-subagents-prompts.md`
- `module.vex-agent.engine-compact` — `modules/vex-agent/engine-compact.md`
- `module.vex-agent.inference` — `modules/vex-agent/inference.md`
- `module.vex-agent.tools-internal` — `modules/vex-agent/tools-internal.md`
- `module.vex-agent.tools-protocols` — `modules/vex-agent/tools-protocols.md`
- `module.vex-agent.data-memory-knowledge` — `modules/vex-agent/data-memory-knowledge.md`

## root src (Round 2)

- `module.src-root.lib-vault-secrets` — `modules/src-root/lib-vault-secrets.md`
- `module.src-root.lib-wallet` — `modules/src-root/lib-wallet.md`
- `module.src-root.lib-env-config` — `modules/src-root/lib-env-config.md`
- `module.src-root.lib-db-utilities` — `modules/src-root/lib-db-utilities.md`
- `module.src-root.lib-diagnostics` — `modules/src-root/lib-diagnostics.md`
- `module.src-root.tools-dexscreener` — `modules/src-root/tools-dexscreener.md`
- `module.src-root.tools-khalani` — `modules/src-root/tools-khalani.md`
- `module.src-root.tools-kyberswap` — `modules/src-root/tools-kyberswap.md`
- `module.src-root.tools-polymarket` — `modules/src-root/tools-polymarket.md`
- `module.src-root.tools-solana-jupiter-twitter` — `modules/src-root/tools-solana-jupiter-twitter.md`

## vex-app — seed (overview docs, written 2026-05-28 verification)

These short overview docs are useful for one-screen orientation. For depth, follow links to the Round 3 deep docs below.

- `module.vex-app.main-process` — `modules/vex-app/main-process.md`
- `module.vex-app.preload-shared-contracts` — `modules/vex-app/preload-shared-contracts.md`
- `module.vex-app.renderer-appshell` — `modules/vex-app/renderer-appshell.md`
- `module.vex-app.local-services-docker` — `modules/vex-app/local-services-docker.md`
- `module.vex-app.packaging-build-release-updater` — `modules/vex-app/packaging-build-release-updater.md`
- `module.vex-app.ci-quality-gates` — `modules/vex-app/ci-quality-gates.md`

## vex-app — Round 3 deep (10 zones, ~5500 lines combined)

- `module.vex-app.main-bootstrap-lifecycle` — `modules/vex-app/main-bootstrap-lifecycle.md` — index.ts boot, single-instance, app-protocol, permissions, fuses, drain order
- `module.vex-app.main-agent-bridge` — `modules/vex-app/main-agent-bridge.md` — transcript/stream/control bridges + compact/wake supervisors + F5 evidence
- `module.vex-app.main-secrets-wallet-support` — `modules/vex-app/main-secrets-wallet-support.md` — unlock/lock, vault inject, wallet export, telemetry consent, support bundle
- `module.vex-app.main-database-migrations` — `modules/vex-app/main-database-migrations.md` — raw `pg` layer, migrate-runner, schema 027/24 SQL, dim-lock, sync-worker gap
- `module.vex-app.main-ipc-engine-orchestration` — `modules/vex-app/main-ipc-engine-orchestration.md` — registerHandler, cancel registry, chat/mission/runtime/approvals/sessions handlers
- `module.vex-app.main-docker-compose-onboarding` — `modules/vex-app/main-docker-compose-onboarding.md` — Docker probe/start/install, Compose render, wizard writers, F1 reset-provider
- `module.vex-app.preload-channels-events-errors` — `modules/vex-app/preload-channels-events-errors.md` — CH/EV/error/domain inventory, reserved/unbridged constants, F5/F6 evidence
- `module.vex-app.shared-schemas-bridge-types` — `modules/vex-app/shared-schemas-bridge-types.md` — Zod schema + bridge type map, F6 enumeration
- `module.vex-app.renderer-appshell-runtime` — `modules/vex-app/renderer-appshell-runtime.md` — active-session UI, transcript, approvals, composer, slash, queryKeys
- `module.vex-app.renderer-onboarding-bootstrap-secrets` — `modules/vex-app/renderer-onboarding-bootstrap-secrets.md` — splash→systemCheck→docker→compose→migrations→wizard→unlock UI

## Cross-cuts

- Flows: see `flows/_INDEX.md` — 6 FLOW-* docs (chat-turn, mission-start, approval-restricted, wake-resume, compaction-tracks, onboarding-config-write).
- Boundaries: see `boundaries/_INDEX.md` — 4 boundary docs (process, ipc, env-secrets, database).
- Decisions: see `decisions/ADR-0001-global-model-session-wallet.md`.
- Audits: see `audits/current/{coverage-gaps,quality-findings,security-review}.md`.
- Bug RCA: see `Deep-F1-model-provider-bug.md`.
- Fix plans: see `fix-plans/F1`, `F2`, `F3` (all shipped on `main`).
