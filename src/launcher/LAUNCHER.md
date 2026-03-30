# Launcher — Local Web Dashboard & API

> HTTP server on `127.0.0.1:4200` that serves a React dashboard and exposes REST API endpoints for setup, diagnostics, wallet, funding, bridge, daemon control, and agent management. All handler logic delegates to existing CLI modules — zero logic duplication.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove routes, update handler descriptions, fix stale references.

---

## Directory Structure

```
src/launcher/
  server.ts           — HTTP server: static file serving (SPA), API dispatch, PID management
  routes.ts           — Route registry + dispatcher (pattern matching with :param segments)
  types.ts            — RouteHandler, RouteParams, RouteEntry, ApiError, DaemonStatus
  process.ts          — Launcher process lifecycle (readPid, stop with SIGTERM→SIGKILL, stale detection)
  core-compute.ts     — Compute readiness checker (wallet, broker, ledger, subAccount, ack)
  handlers/
    agent.ts          — Agent readiness, start (Docker compose), password setup
    bridge.ts         — Khalani cross-chain bridge (chains, quote, execute)
    catalog.ts        — No-op (removed, kept for import compat)
    claude.ts         — Claude proxy health, config inject/remove/restore, proxy start/stop
    connect.ts        — AI runtime connect plan/apply
    daemons.ts        — Daemon status/start/stop for proxy, monitor, bot, launcher
    fund.ts           — Compute funding: view, plan, deposit, fund provider, ACK, API key
    openclaw.ts       — OpenClaw onboarding steps (non-interactive HTTP equivalents)
    runtime-update.ts — Agent runtime update status, retry pull, apply update
    snapshot.ts       — Status snapshot, doctor checks, verify, support report
    tavily.ts         — Tavily API key status + save
    wallet.ts         — Password, wallet create/import, backup/restore, export
  ui/                 — React frontend (Vite build → dist/launcher-ui/)
    src/
      App.tsx, main.tsx, index.css
      api.ts          — Fetch wrapper for launcher API
      utils.ts        — UI helpers
      utils/          — runtime-meta, wizard-bootstrap
      components/     — React components
      steps/          — Wizard step components
      views/          — Dashboard views (wizard, etc.)
    vite.config.ts    — Vite build config (outputs to dist/launcher-ui/)
```

---

## Architecture

```
Browser (http://127.0.0.1:4200)
  │
  ├── GET /* (non-API) → Static file server (dist/launcher-ui/)
  │                       SPA fallback: serves index.html for all non-file paths
  │
  └── /api/* → Route dispatcher (routes.ts)
                ├── Pattern matching: static segments + :param
                ├── Query string parsing
                ├── JSON body parsing (POST)
                └── Handler invocation → jsonResponse / errorResponse
```

---

## API Routes

### Snapshot & Diagnostics

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/snapshot` | snapshot.ts | Full system snapshot (wallet, compute, providers, daemons) |
| GET | `/api/doctor` | snapshot.ts | Doctor checks |
| GET | `/api/verify` | snapshot.ts | Runtime verify |
| GET | `/api/support-report` | snapshot.ts | Generate support report |

### Agent (Docker)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/agent/readiness` | agent.ts | Docker, wallet, password, compute checks (cached 30s) |
| POST | `/api/agent/start` | agent.ts | Start agent via docker compose |
| POST | `/api/agent/password` | agent.ts | Save keystore password to .env |

### Wallet

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/api/wallet/create` | wallet.ts | Create EVM or Solana wallet |
| POST | `/api/wallet/import` | wallet.ts | Import private key |
| POST | `/api/wallet/backup` | wallet.ts | Create backup archive |
| POST | `/api/wallet/restore` | wallet.ts | Restore from backup |
| POST | `/api/wallet/export-key` | wallet.ts | Export private key |

### Funding (0G Compute)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/fund/view` | fund.ts | Current funding state |
| GET | `/api/fund/plan` | fund.ts | Funding plan |
| POST | `/api/fund/deposit` | fund.ts | Deposit to ledger |
| POST | `/api/fund/provider` | fund.ts | Fund provider |
| POST | `/api/fund/ack` | fund.ts | Acknowledge provider signer |
| POST | `/api/fund/api-key` | fund.ts | Create API key |
| GET | `/api/fund/providers` | fund.ts | List chat services |

### Connect (AI Runtime)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/connect/plan` | connect.ts | Connect plan for runtime |
| POST | `/api/connect/apply` | connect.ts | Apply connect actions |

### Bridge (Khalani)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/bridge/chains` | bridge.ts | Supported chains |
| POST | `/api/bridge/quote` | bridge.ts | Get bridge quote |
| POST | `/api/bridge/execute` | bridge.ts | Execute bridge transaction |

### Daemons

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/daemons` | daemons.ts | Status of all daemons (proxy, monitor, bot) |
| POST | `/api/daemons/:name/start` | daemons.ts | Start daemon by name |
| POST | `/api/daemons/:name/stop` | daemons.ts | Stop daemon by name |

### Claude Proxy

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/claude/health` | claude.ts | Proxy health + config |
| POST | `/api/claude/config/inject` | claude.ts | Inject Claude settings |
| POST | `/api/claude/config/remove` | claude.ts | Remove Claude settings |
| POST | `/api/claude/config/restore` | claude.ts | Restore backup settings |
| POST | `/api/claude/proxy/start` | claude.ts | Start proxy daemon |
| POST | `/api/claude/proxy/stop` | claude.ts | Stop proxy daemon |

### Runtime Update

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/runtime-update/status` | runtime-update.ts | Update status (pull, apply readiness) |
| POST | `/api/runtime-update/retry` | runtime-update.ts | Retry failed image pull |
| POST | `/api/runtime-update/apply` | runtime-update.ts | Apply pending update |

### Other

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/api/tavily/status` | tavily.ts | Tavily key configured? |
| POST | `/api/tavily/key` | tavily.ts | Save Tavily key + restart agent |
| POST | `/api/openclaw/*` | openclaw.ts | OpenClaw onboarding steps (HTTP equivalents) |

---

## Process Management (`process.ts`)

- `readLauncherPid()` — read PID from file
- `stopLauncherProcess()` — SIGTERM → poll → SIGKILL (5s timeout), cleanup PID + optional stopped marker

---

## Core Compute Readiness (`core-compute.ts`)

5 required checks: `wallet`, `broker`, `ledger`, `subAccount`, `ack`. Used by agent readiness endpoint.

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `commands/echo/*` | snapshot, doctor, assessment, connect, fund, claude-health |
| `commands/khalani/*` | bridge request/helpers |
| `commands/claude/*` | config inject/remove/restore |
| `tools/wallet/*` | create, import, keystore, auth |
| `tools/0g-compute/*` | readiness, constants |
| `tools/khalani/*` | client, chains |
| `config/*` | paths, store |
| `utils/*` | logger, daemon-spawn |
| `update/*` | runtime-update-service |
| `agent-shim.ts` | Docker compose (TODO: migrate to echo-agent/) |
| `providers/*` | env-resolution, registry |
| `openclaw/*` | config patching |

---

## UI (React Frontend)

Built with Vite (`src/launcher/ui/vite.config.ts`) → outputs to `dist/launcher-ui/`. Server serves it as static files with SPA fallback. Key files:

- `api.ts` — fetch wrapper for all `/api/*` endpoints
- `views/wizard/` — setup wizard UI
- `steps/` — wizard step components
- `components/` — shared UI components

---

## Tests

```bash
npx vitest run src/__tests__/cli/    # Launcher command tests
npx vitest run src/__tests__/onboard/ # Onboarding-related tests
```
