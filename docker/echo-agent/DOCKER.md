# Echo Agent — Docker Stack

> Two-container stack: Echo Agent (Node.js) + Postgres 16. Managed by CLI via `echoclaw echo agent start/stop/status/reset`. Prebuilt multi-arch images from GHCR, matched to npm package version.
>
> **Last updated: 2026-03-31**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove services, update env vars, fix stale references.

---

## Files

```
docker/echo-agent/
  docker-compose.yml       — Production stack: agent + postgres, volume mount, healthchecks
  docker-compose.build.yml — Local build override (builds agent image from source)
  Dockerfile               — Multi-stage: build (pnpm + tsc) → runtime (node:22-bookworm-slim)
  .env.example             — Template for required/optional env vars
```

---

## Services

### `agent` — Echo Agent (Node.js)

| Setting | Value |
|---------|-------|
| Image | `ghcr.io/echoclaw-labs/echoclaw/echo-agent:latest` (override via `ECHO_AGENT_IMAGE`) |
| Port | `4201` (override via `AGENT_PORT`) |
| Bind | `0.0.0.0` inside container |
| Healthcheck | `GET http://127.0.0.1:4201/api/agent/health` every 10s |
| Restart | `unless-stopped` |
| Entrypoint | `node dist/agent/server.js` |

Volumes:
- Host `~/.config/echoclaw` → Container `/root/.config/echoclaw` (wallet keystore, config, .env shared with CLI)

### `postgres` — Postgres 16 Alpine

| Setting | Value |
|---------|-------|
| Image | `postgres:16-alpine` |
| Database | `echo_agent` |
| User | `echo_agent` |
| Password | `AGENT_POSTGRES_PASSWORD` (default: `echo_agent`) |
| Healthcheck | `pg_isready -U echo_agent` every 5s |
| Data | Named volume `pgdata` (persistent across restarts) |

Agent depends on postgres `service_healthy` — waits for DB before starting.

---

## Environment Variables

### Required

| Variable | Source | Purpose |
|----------|--------|---------|
| `ECHO_KEYSTORE_PASSWORD` | `~/.echoclaw/.env` or shell | Decrypt wallet keystore inside container |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `ECHO_AGENT_IMAGE` | `ghcr.io/echoclaw-labs/echoclaw/echo-agent:latest` | Agent Docker image |
| `AGENT_PORT` | `4201` | Host port mapping |
| `AGENT_POSTGRES_PASSWORD` | `echo_agent` | Postgres password |
| `TAVILY_API_KEY` | — | Web search (Tavily, 1000 free/month) |
| `ECHO_CONFIG_DIR` | `~/.config/echoclaw` | Host config dir (auto-detected by CLI) |
| `LOG_FORMAT` | auto | `json` or `pretty` (auto-detected from TTY) |

The CLI auto-injects `ECHO_KEYSTORE_PASSWORD` and `TAVILY_API_KEY` from `~/.echoclaw/.env` before running `docker compose up`.

---

## Dockerfile (Multi-stage)

### Build stage (`node:22-bookworm-slim`)

```
apt-get install python3 make g++     ← native addon build tools
pnpm install --frozen-lockfile       ← all deps including devDependencies
pnpm run build                       ← tsc + tsc-alias + vite (launcher UI)
pnpm prune --prod                    ← remove devDependencies
```

### Runtime stage (`node:22-bookworm-slim`)

```
COPY node_modules, package.json, dist/, skills/
COPY SQL migrations (tsc doesn't copy .sql)
ln -s dist/cli.js /usr/local/bin/echoclaw
EXPOSE 4201
CMD ["node", "dist/agent/server.js"]
```

**Note:** The Dockerfile currently references `src/agent/db/migrations` which was part of the legacy agent. This needs updating when echo-agent DB migrations are finalized.

---

## CLI Management

| Command | What it does |
|---------|-------------|
| `echoclaw echo agent start` | `docker compose up -d`, wait for health, open browser |
| `echoclaw echo agent stop` | `docker compose down` |
| `echoclaw echo agent status` | Check running + health endpoint |
| `echoclaw echo agent reset` | `docker compose down -v` (destroys pgdata volume = full DB reset) |
| `echoclaw echo agent backup` | POST to `/api/agent/backup` → 0G Storage snapshot |
| `echoclaw echo agent restore --root <hash>` | POST to `/api/agent/restore` |

### Compose project name

`echo-agent` — used for `docker compose -p echo-agent` in all CLI calls.

### Local build

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

The build override sets `build.context: ../..` and `build.dockerfile: docker/echo-agent/Dockerfile`.

---

## Runtime Update Flow

When the npm package is auto-updated:

1. `markPackageAutoUpdated(version)` sets target in `~/.echoclaw/runtime-update.json`
2. `startRuntimeUpdatePullInBackground()` runs `docker compose pull agent` (5min timeout)
3. `applyRuntimeUpdate()` runs `docker compose up -d --force-recreate agent` + health poll
4. If health OK → clear pending update state

Currently in TODO-mode via `agent-shim.ts` — Docker functions throw until echo-agent migration is complete.

---

## Data Persistence

| Data | Storage | Survives restart | Survives reset |
|------|---------|-----------------|----------------|
| Postgres data | `pgdata` named volume | Yes | **No** (`down -v` destroys) |
| Wallet keystore | Host `~/.echoclaw/keystore.json` (volume mount) | Yes | Yes |
| Config | Host `~/.echoclaw/config.json` (volume mount) | Yes | Yes |
| Agent token | Host `~/.echoclaw/agent/agent.token` (volume mount) | Yes | Yes |

---

## Networking

- Agent binds `0.0.0.0:4201` inside container
- Host maps `127.0.0.1:4201` → container (default, override via `AGENT_PORT`)
- Postgres is internal only (no port exposed to host)
- Agent connects to postgres via Docker network DNS: `postgres:5432`
