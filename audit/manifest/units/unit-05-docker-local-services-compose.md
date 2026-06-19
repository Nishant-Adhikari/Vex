### 2.5 Work Unit 5 — Docker/local services/Compose

#### Files & LOC

- `vex-app/resources/compose/docker-compose.template.yml` 191 LOC
- `vex-app/resources/compose/docker-compose.e2e.yml` 34 LOC
- `vex-app/src/main/compose/lifecycle.ts` 821 LOC — **god-file/refactor candidate**
- `vex-app/src/main/compose/render.ts` 159 LOC
- `vex-app/src/main/compose/embeddings-health.ts` 227 LOC
- `vex-app/src/main/compose/electron-secret-adapter.ts` 109 LOC
- `vex-app/src/main/docker/probe.ts` 342 LOC — **god-file/refactor candidate**
- `vex-app/src/main/docker/spawn-runner.ts` 244 LOC
- `vex-app/src/main/docker/endpoint-policy.ts` 137 LOC
- `vex-app/src/main/docker/install.ts` 190 LOC
- `vex-app/src/main/ipc/docker.ts` 286 LOC
- `vex-app/src/renderer/features/docker/BootstrapPanel.tsx` 341 LOC — **god-file/refactor candidate**

#### Responsibility

- Compose template defines local Postgres/pgvector and embedding service.
- Docker modules detect daemon/CLI/context/ports and run bounded subprocesses.
- Compose lifecycle renders config, starts/stops services, checks health, handles reuse/recovery.
- Docker IPC exposes detect/install/start/compose-up/down to renderer through main.
- Renderer Docker/Compose screens show setup state only; no direct Docker access.

#### Mechanisms/patterns

- Digest-pinned images.
- `host_ip: 127.0.0.1` for exposed ports.
- Per-install generated DB password.
- Compose secret file.
- Named volumes with Vex labels.
- Remote Docker context rejection.
- Bounded stdout/stderr buffers.
- Redacted Docker log lines before renderer broadcast.
- Abortable subprocesses.
- Health probes for Postgres/embedding service.
- Normal quit stops services rather than deleting volumes.

#### Dependencies & data-flow

Entry points:

- Renderer Docker/Compose UI -> `window.vex.docker.*`.
- Preload validates payloads.
- `main/ipc/docker.ts` handles requests.
- `compose/lifecycle.ts` orchestrates Docker CLI and health.
- On success, main DB connection state is updated.

Imports/dependencies:

- Docker lifecycle uses endpoint policy, probe, spawn runner, render, DB config.
- Renderer uses typed bridge only.
- Build checks inspect Compose resources.

Side effects:

- Docker CLI:
  - `docker --version`
  - `docker compose version`
  - `docker info --format`
  - `docker context show`
  - `docker context inspect`
  - `docker ps`
  - `docker compose pull`
  - `docker compose up -d`
  - `docker compose stop`
  - gated `docker compose down --remove-orphans --volumes`
- OS commands:
  - macOS `open -a Docker`
  - Windows `docker desktop start` / PowerShell start process
  - Linux `systemctl --user start docker-desktop`
- Filesystem:
  - `.install-id`
  - `local-infra/secrets/pg_password`
  - rendered `compose/docker-compose.yml`
- Network:
  - Docker Desktop download from `desktop.docker.com`
  - embedding health calls to loopback
  - Hugging Face model download inside init container with SHA-256 verification.

#### Security surface

- Renderer has no Docker authority.
- Main validates Docker endpoint is local.
- Compose ports are loopback only.
- DB password path/port stripped from public result.
- Docker install is user-triggered, not silent.
- Destructive volume removal is gated to pre-setup recovery.

#### Hotspots

- `compose/lifecycle.ts` 821 LOC mixes too many concerns.
- `probe.ts` 342 LOC is substantial and OS/CLI-specific.
- No runtime-selected fallback ports; fixed ports return `port_collision`.
- DB password stored plaintext with mode `0600`.
- `composeOutPath`, install ID, installer `artifactPath`, and some recovery logs expose local paths/identifiers to renderer/logs.
- Docker Desktop download lacks explicit checksum/signature verification.
- Linux instructions include `sudo usermod -aG docker $USER`; user-facing risk copy should call out Docker group privilege.

`console.*` density:

- Docker subprocess output is routed through redacted line callbacks, not direct console. Scripts may use console outside runtime.

#### Tests

Covered:

- Endpoint policy tests.
- Docker probe/start/install/spawn tests.
- Compose render/idempotent secret/mode tests.
- Compose template sync tests.
- Embeddings health tests.
- Compose-up IPC cancellation/single-flight tests.
- Renderer Docker/Compose screen tests.
- Build artifact gate checks digest-pinned images and loopback ports.

Not covered / unclear:

- Live production Compose startup in CI.
- Reset-local-services UX/API.
- Unhealthy service recovery integration.
- Docker Desktop installer checksum.
- Full quit/update restart cleanup.

#### Open risks/smells

- Split lifecycle into render/preflight/start/reuse/recovery/health/stop modules.
- Add explicit reset-local-services flow with destructive confirmation.
- Add checksum/signature validation or stronger user confirmation for installer downloads.
- Decide whether renderer needs local paths/IDs in DTOs.
- Fix migration mirror drift before packaging.

