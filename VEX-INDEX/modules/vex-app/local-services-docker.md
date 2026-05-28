---
id: module.vex-app.local-services-docker
kind: module
paths:
  - "vex-app/resources/compose/**"
  - "vex-app/src/main/docker/**"
  - "vex-app/src/main/compose/**"
  - "vex-app/src/main/database/**"
  - "vex-app/src/main/ipc/docker.ts"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "vex-app/resources/compose/**"
  - "vex-app/src/main/docker/**"
  - "vex-app/src/main/compose/**"
  - "vex-app/src/main/database/**"
  - "vex-app/src/main/ipc/docker.ts"
  - "vex-app/src/shared/embedding-defaults.ts"
  - "vex-app/src/main/onboarding/embedding-defaults.ts"
  - "vex-app/scripts/check-build-artifacts.mjs"
  - ".agents/skills/vex-project-rules/references/50-containers-and-runtime.md"
related:
  - module.vex-app.main-process
  - module.vex-agent.data-memory-knowledge
---

# vex-app Local Services / Docker

## Purpose

Owns local Docker prerequisite UX, Compose rendering/lifecycle, local Postgres/pgvector,
embedding service, migration status, health probes, and DB connection handoff to main/engine.

## Current compose model

- Template: `vex-app/resources/compose/docker-compose.template.yml`.
- Services: `db`, `embeddings-model-init`, `embeddings-runtime`.
- Host ports: Postgres `127.0.0.1:55432` by default, embeddings `127.0.0.1:55134` by default.
- Embeddings runtime: `ghcr.io/ggml-org/llama.cpp:server-*`, container port `8080`, OpenAI-compatible `/v1/embeddings`, alias `ai/embeddinggemma:300M-Q8_0`.
- No Docker Model Runner dependency in compose; `:12434` probes are legacy/status-only unless proven otherwise.
- Compose floor: 2.23.1 for inline `configs.content`.
- Normal quit uses stop/preserve-volume behavior, not `down --volumes`.

## Invariants

- Vex must not silently install or reconfigure Docker.
- Ports bind to `127.0.0.1`; remote Docker contexts are rejected because data/secrets must stay local.
- Compose `$VAR` interpolation applies before container shell; shell references inside configs must be escaped as `$$VAR`.
- Migration mirror and packaged resources must match canonical engine migrations.

## Known gaps

- Full Docker bootstrap/compose/migration/wizard/unlock E2E is intentionally shallow in current smoke tests.
- Windows arm64 app packaging exists, but Docker Desktop installer URL support appears x64-only.
- Docker Model Runner status probe may confuse diagnostics now that bundled embeddings use llama.cpp.

## Refresh triggers

Any compose template, Docker detection/start/install/endpoint-policy, database migration runner,
embedding defaults, or artifact check changes.
