# EchoClaw

Native Crypto MCP + Vex Agent core.

## Status

`private` / pre-MCP / internal dev-only. No public entrypoint yet.

## Structure

```
src/echo-agent/   Core agent: engine, tools, DB, sync, inference, E2E MCP harness
src/tools/        13 protocol SDK clients (khalani, kyberswap, polymarket, jupiter, jaine, slop, chainscan, dexscreener, echobook, 0g-compute, 0g-storage, wallet, slop-app)
src/config/       App config and paths
src/constants/    Chain constants
src/utils/        Shared utilities (logger, http, validation, rate limiting)
src/errors.ts     Error codes and types
```

## Development

```bash
pnpm install
pnpm run build      # tsc + tsc-alias
pnpm run dev        # tsc --watch
```

## Testing

```bash
pnpm test           # vitest — all retained suites
make lint           # tsc --noEmit (includes tests)
make check          # lint + test
```

## E2E (requires Docker)

```bash
make e2e-db-up      # start tmpfs Postgres on port 5555
make e2e-db-down    # stop
```

MCP E2E server: `pnpm exec tsx src/echo-agent/e2e/mcp/server.ts`

## Requirements

- Node >= 22
- pnpm 10+
- Docker (for E2E tests only)
