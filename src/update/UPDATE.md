# Update — Auto-update & Runtime Update System

> Two-layer update system: (1) npm package auto-update with background worker, and (2) Docker agent image pull/apply for runtime updates. Includes legacy daemon cleanup.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update flow descriptions, fix stale references.

---

## Directory Structure

```
src/update/
  constants.ts              — Legacy updater artifact paths (PID, shutdown, state, log)
  auto-update-preference.ts — Read/write ECHO_AUTO_UPDATE preference (3-source chain)
  updater.ts                — Update check: npm registry fetch, semver compare, background worker spawn
  auto-update-worker.ts     — Background worker: npm install -g, restart launcher, release lock
  cli-bootstrap.ts          — Pre-action hook: retire legacy daemon, seed default, trigger check
  legacy-runtime.ts         — Detect and retire old update daemon artifacts (SIGTERM→file→SIGKILL)
  runtime-update-state.ts   — Runtime update state persistence (pull status, lock file, package version lookup)
  runtime-update-service.ts — Agent Docker image pull/apply lifecycle with temporary TODO-mode fallback
```

---

## Layer 1: npm Package Auto-update

### Flow

```
CLI startup (cli-auto-update.ts preAction hook)
  │
  ▼
cli-bootstrap.ts: runAutoUpdateBootstrap()
  ├── retireLegacyUpdateDaemon() — clean old daemon artifacts
  ├── ensureAutoUpdateDefault()  — seed ECHO_AUTO_UPDATE=1 if no preference
  └── startUpdateCheck()
        │
        ▼
      updater.ts: checkForUpdates()
        ├── Rate limit (1h interval)
        ├── Fetch https://registry.npmjs.org/@echoclaw%2Fecho/latest
        ├── Compare semver
        └── If newer + auto-update enabled:
              ├── Acquire file lock (stale after 10min)
              └── spawnAutoUpdateWorker() (detached background process)
                    │
                    ▼
                  auto-update-worker.ts: runAutoUpdateWorker()
                    ├── npm install -g @echoclaw/echo@latest (15min timeout)
                    ├── markPackageAutoUpdated(version)
                    ├── restartLauncherIfRunning()
                    └── releaseUpdateLock()
```

### Preference Chain (`auto-update-preference.ts`)

Checked in order (first match wins):

| Priority | Source | Effect |
|----------|--------|--------|
| 1 | `ECHO_DISABLE_UPDATE_CHECK=1` | Disabled (kills all checks) |
| 2 | `process.env.ECHO_AUTO_UPDATE` | `"1"` = enabled, `"0"` = disabled |
| 3 | `~/.echoclaw/.env` → `ECHO_AUTO_UPDATE` | Same |
| 4 | None set | Default seeded to `"1"` on first CLI run |

### Locking

- `~/.echoclaw/update-check.lock` — file-based exclusive lock
- Stale after 10 minutes (auto-reclaimed)
- Prevents concurrent update workers

### Skip conditions

- `echoclaw update *` commands skip the bootstrap entirely
- `--help`, `--version` skip update check
- Headless mode without auto-update enabled skips check

---

## Layer 2: Runtime (Docker Agent) Update

### State Machine (`runtime-update-state.ts`)

```
idle → pulling → ready → (apply) → idle
                → failed → (retry) → pulling
```

| Field | Purpose |
|-------|---------|
| `targetPackageVersion` | Version to pull image for |
| `pullStatus` | `idle` / `pulling` / `ready` / `failed` |
| `preparedPackageVersion` | Last successfully pulled version |
| `applyInProgress` | Guard against concurrent apply |

State persisted in `~/.echoclaw/runtime-update.json` (atomic write).

### Pull lock

`~/.echoclaw/runtime-update.pull.lock` — prevents concurrent Docker pulls. Stale after 10 minutes.

### Service (`runtime-update-service.ts`)

| Function | Purpose |
|----------|---------|
| `markPackageAutoUpdated(version)` | Called after npm install — sets target version, triggers pull |
| `getRuntimeUpdateStatus()` | Full status: versions, pull state, readyToApply |
| `startRuntimeUpdatePullInBackground()` | Background `docker compose pull agent` (5min timeout) |
| `retryRuntimeUpdatePull()` | Reset failed state, re-trigger pull |
| `applyRuntimeUpdate()` | `docker compose up -d --force-recreate agent` + health poll |

**Temporary state:** `agent-shim.ts` is still a migration placeholder. Runtime update endpoints now degrade to a passive TODO status instead of throwing legacy-agent exceptions. Pull/apply attempts persist a short TODO error message and keep the pending update intact.

---

## Legacy Daemon Cleanup (`legacy-runtime.ts`)

Old EchoClaw versions ran a persistent update daemon. New versions use one-shot auto-update. This module detects and retires the old daemon:

1. Detect artifacts: PID file, shutdown file, stopped file, state file, log file
2. If daemon running → SIGTERM → wait → shutdown file → wait → SIGKILL (if force)
3. Clean up all artifact files
4. Returns detailed `LegacyUpdateCleanupResult`

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `agent-shim.ts` | Docker compose functions (TODO: migrate) |
| `config/paths.ts` | `CONFIG_DIR` |
| `config/store.ts` | `ensureConfigDir()` |
| `providers/env-resolution.ts` | `readEnvValue()`, `writeAppEnvValue()`, `loadProviderDotenv()` |
| `password/compat.ts` | `ensureAgentPasswordReadyForContainer()` |
| `launcher/process.ts` | `stopLauncherProcess()` |
| `utils/daemon-spawn.ts` | `isDaemonAlive()`, `spawnLauncher()` |
| `utils/http.ts` | `fetchJson()` (npm registry) |
| `utils/logger.ts` | Structured logging |

---

## Tests

```bash
npx vitest run src/__tests__/update/
npx vitest run src/__tests__/runtime/
```

| File | Coverage |
|------|----------|
| `auto-update-preference.test.ts` | 3-source chain, seeding, enable/disable |
| `auto-update-worker.test.ts` | npm install, launcher restart, lock release |
| `update-command.test.ts` | CLI command tree |
| `updater.test.ts` | Semver compare, rate limiting, lock, registry fetch |
| `runtime-meta.test.ts` | Runtime metadata |

`runtime-update-service.test.ts` and `runtime-update-state.test.ts` were removed after the legacy `src/agent/*` modules were deleted. New tests should be written only after runtime update is rewired off the placeholder shim.
