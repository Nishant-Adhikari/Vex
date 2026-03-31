# E2E Test Harness — Echo Agent

> MCP-first E2E harness. Docker Postgres + local stdio MCP server. Claude Code jako zastępcza warstwa inferencji do manualnego testowania persistence pipeline na realnych środkach.
>
> **Last updated: 2026-03-31**
>
> **LLM maintainers:** If you modify any file in this folder, update this document.

---

## Architecture

```
ClaudeCode ──MCP stdio──> LocalTestMcp (pnpm exec tsx)
                              │
                    ┌─────────┴──────────┐
                    │                    │
              dispatchTool()        db-assertions
                    │                    │
              ProtocolRuntime      TestPostgres:5555
                    │                    │
              capture pipeline ──> protocol_executions
                                   protocol_capture_items
                                   proj_activity
                                   proj_open_positions
                                   proj_pnl_lots
```

**Key decision:** Mutating flows tested manually by Claude via `echo_execute`. Automated smoke only for discovery, read-only, and preview (dryRun).

---

## Quick Start

```bash
# 1. Start test Postgres (port 5555, tmpfs — ephemeral)
docker compose -f docker/echo-agent/docker-compose.e2e.yml up -d

# 2. Verify startup smoke (alias resolve + DB connect + migrations)
ECHO_AGENT_DB_URL=postgresql://echo_agent:echo_agent@localhost:5555/echo_agent_test \
  pnpm exec tsx src/echo-agent/e2e/mcp/server.ts --smoke

# 3. Copy MCP config
cp .mcp.e2e.json.example .mcp.e2e.json

# 4. Register MCP in Claude Code
claude mcp add --transport stdio echo-agent-e2e -- pnpm exec tsx src/echo-agent/e2e/mcp/server.ts

# 5. Or run isolated session
ECHO_AGENT_DB_URL=postgresql://echo_agent:echo_agent@localhost:5555/echo_agent_test \
  claude --strict-mcp-config --mcp-config .mcp.e2e.json
```

---

## Directory Structure

```
src/echo-agent/e2e/
  core/
    scenario-runner.ts     — Setup, teardown, runStep, runScenario, makeContext
    discovery-smoke.ts     — Discovery enumeration per active namespace
    preview-smoke.ts       — dryRun zero-write verification (5 pipeline tables)
    db-assertions.ts       — Pipeline table assertions + inspectTable (whitelisted)
    replay-check.ts        — Replay smoke (snapshot before/after)
  mcp/
    server.ts              — MCP stdio server with startup smoke
    tools.ts               — 9 MCP tools (echo_* prefixed)
  scenarios/
    index.ts               — Scenario registry (ALL_SCENARIOS)
  TESTSCENARIO.md          — Runbook for Claude as manual debugger
  E2E.md                   — This file
```

---

## MCP Tools (v1)

| Tool | Type | Purpose |
|------|------|---------|
| `echo_discover` | Core | Search protocol capabilities (via dispatchTool) |
| `echo_execute` | Core | Execute protocol tool (via dispatchTool, with capture pipeline) |
| `echo_wallet_read` | Read-only | Wallet address + multi-chain balances |
| `echo_portfolio_inspect` | Read-only | DB inspection: positions, activity, balances, snapshots. **No lots.** |
| `echo_inspect_pipeline` | Operator | Whitelisted read-only query on 5 pipeline tables. Filters: executionId, toolId, positionKey, sessionId. |
| `echo_replay_verify` | Operator | Run replayProjections() + compare before/after counts |
| `echo_run_scenario` | Operator | Run named scenario from registry |
| `echo_discovery_smoke` | Smoke | Automated discovery check for all active namespaces |
| `echo_preview_smoke` | Smoke | Automated dryRun zero-write verification |

---

## ENV Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ECHO_AGENT_DB_URL` | Yes | — | Test Postgres connection string |
| `JUPITER_API_KEY` | For Solana tools | — | Jupiter API access |
| `POLYMARKET_API_KEY` | For Polymarket | — | CLOB trading auth |
| `TAVILY_API_KEY` | No | — | Web search (not needed for E2E) |

---

## Reset / Cleanup

```bash
# Full DB reset (destroy + recreate — tmpfs makes this instant)
docker compose -f docker/echo-agent/docker-compose.e2e.yml down
docker compose -f docker/echo-agent/docker-compose.e2e.yml up -d

# After reset: MCP server runs migrations on next startup automatically
```

**Important:** After `resetAll()` (operator CLI), call `initSync()` to reseed `protocol_sync_jobs`.

---

## Safety

- **Max notional:** $5 USD equivalent per transaction
- **Real funds:** All mutations use real wallets on real chains
- **Preview first:** Always run `echo_preview_smoke` before live mutations
- **Inspect after:** Check DB state via `echo_inspect_pipeline` after every mutation
- **Stop if:** Unexpected balance drop, handler error, DB inconsistency

---

## Test Coverage Model

| Layer | Method | Scope |
|-------|--------|-------|
| Discovery | Automated (`echo_discovery_smoke`) | All active namespaces |
| Preview | Automated (`echo_preview_smoke`) | 5 representative tools |
| Live mutations | Manual (Claude + `echo_execute`) | Per TESTSCENARIO.md |
| Replay | Semi-automated (`echo_replay_verify`) | After multi-namespace session |

See `TESTSCENARIO.md` for the full manual test runbook.
