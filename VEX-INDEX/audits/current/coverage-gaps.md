---
id: audit.current.coverage-gaps
kind: audit
paths: ["src/**", "vex-app/**", ".github/workflows/**"]
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change: ["src/**", "vex-app/**", ".github/workflows/**", "VEX-INDEX/modules/**/*.md"]
related: [index.structure, index.modules]
---

# Current Coverage Gaps

| ID | Area | Status | Evidence |
|---|---|---|---|
| GAP-Z6-sync-worker | Sync executor not wired in desktop boot | open | `vex-app/src/main/index.ts` starts compact+wake only; `src/vex-agent/sync` has executor APIs |
| GAP-Z7-control-state-bridge | `EV.engine.controlState` not exposed to renderer | open | main publishes control state; preload engine bridge exposes transcript/stream only |
| GAP-Z7-runtime-types | Runtime bridge return types use legacy result shape | open | shared bridge type differs from per-action runtime schemas |
| GAP-updater | Updater is placeholder-only | open | dependency/channels exist, no registered handler/autoUpdater implementation |
| GAP-release | Production release gates missing | open | builder profile unsigned; CI has no signing/notarization/update metadata/checksum workflow |
| GAP-docker-e2e | Full Docker/Compose/migration/onboarding E2E absent | open | smoke test excludes daemon/bootstrap/wizard/unlock |
| GAP-vex-app-deep-index | vex-app module docs are seed-level | open | created from 10-agent verification; requires later focused 10-agent expansion |

Fixed/superseded gaps: F1 `.env` boot-load, F2 wake worker, F3 approval card UI.
