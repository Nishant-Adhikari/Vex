# Utils — Shared Utilities

> Cross-cutting primitives used across the entire codebase: logging, output routing, UI components, HTTP, .env parsing, validation, rate limiting, daemon management, and legacy cleanup.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/utils/
  logger.ts             — Winston logger (stderr only, structured JSON or colorized)
  output.ts             — stdout/stderr separation, headless detection, JSON output helpers
  respond.ts            — Unified command response: JSON (headless) or UI box (TTY)
  ui.ts                 — CLI UI: colored boxes, spinners, tables, formatters, block-letter logo
  banner.ts             — EchoClaw block-letter banner with framed subtitle
  env.ts                — Keystore password resolution (2-level fallback chain)
  dotenv.ts             — .env file read/write/load (zero dependencies, atomic write)
  http.ts               — fetch with timeout, JSON parse, error standardization
  validation.ts         — parseInt, slippage validation
  validation-helpers.ts — Field validator factory for API response validation (shared across clients)
  rateLimit.ts          — TokenBucket rate limiter + ConcurrencyLimiter (FIFO)
  canonicalJson.ts      — Deterministic JSON (sorted keys) for hash computation
  daemon-spawn.ts       — Detached daemon spawning (monitor, bot, proxy, launcher)
  daemon-resurrect.ts   — Auto-resurrect crashed daemons on CLI startup
  legacy-cleanup.ts     — Remove legacy echoclaw() bash function from .bashrc/.zshrc
  minimatch.ts          — Simple glob pattern matching (*, ?, **)
```

---

## Output Architecture

```
stdout → machine-readable data (JSON, addresses) for piping/scripting
stderr → human UI (spinners, boxes, tables, logs)
```

| File | Role |
|------|------|
| `output.ts` | Core: `writeStdout`/`writeStderr`, `isHeadless()`, `writeJsonSuccess`/`writeJsonError` |
| `respond.ts` | Command-level: auto-routes `CommandResult` to JSON or UI box based on mode |
| `ui.ts` | Visual: `successBox`/`errorBox`/`infoBox`/`warnBox`, `spinner`, `printTable`, `formatAddress`/`formatBalance` |
| `banner.ts` | Block-letter ECHOCLAW banner with subtitle frame |

Headless detection: `--json` flag, `ECHOCLAW_JSON=1`, or non-TTY stderr.

---

## Logging (`logger.ts`)

Winston-based, all output to **stderr** (stdout reserved for data).

| ENV | Effect |
|-----|--------|
| `LOG_LEVEL` | Default: `info`. Set to `debug` for verbose. |
| `LOG_FORMAT=json` | Force structured JSON (default for non-TTY) |
| `LOG_FORMAT=pretty` | Force colorized (default for TTY) |

`createChildLogger(meta)` — add context (requestId, sessionId) to log entries.

---

## Environment & .env (`env.ts`, `dotenv.ts`)

### Password resolution (`env.ts`)

2-level fallback:
1. `process.env.ECHO_KEYSTORE_PASSWORD` (non-empty, not `"undefined"`)
2. `~/.echoclaw/.env` → `ECHO_KEYSTORE_PASSWORD`

Resolved value cached in `process.env` for subsequent calls.

### .env file ops (`dotenv.ts`)

Zero-dependency .env parser:
- `readDotenvFileValue(key, path)` — single key read, handles double-quoted values
- `loadDotenvFileIntoProcess(path)` — load all keys (skip existing env vars, skip `#` comments)
- `appendToDotenvFile(key, value, path)` — upsert key (atomic write: tmp + rename, mode 0o600)

---

## HTTP (`http.ts`)

| Function | Purpose |
|----------|---------|
| `fetchWithTimeout(url, opts)` | fetch + AbortController timeout (default 30s) |
| `parseJsonResponse<T>(res)` | JSON parse with HTTP error handling |
| `fetchJson<T>(url, opts)` | Combined fetch + parse |
| `readJson(res)` | Safe JSON read (returns `null` on parse failure) |

All errors wrapped as `EchoError` with appropriate codes.

---

## Validation

### `validation.ts`
- `parseIntSafe(value, name)` — parseInt with NaN guard
- `validateSlippage(bps)` — 0–5000 bps range check

### `validation-helpers.ts`
Factory for domain-scoped field validators:
```typescript
const { asString, asNumber, asOptionalString } = createFieldValidators(
  ErrorCodes.KHALANI_API_ERROR, "Khalani"
);
```
Used by: Khalani, DexScreener, KyberSwap, Polymarket API clients.

---

## Rate Limiting (`rateLimit.ts`)

| Class | Algorithm | Used by |
|-------|-----------|---------|
| `TokenBucket` | Token bucket (refill per ms) | ChainScan, Subgraph clients |
| `ConcurrencyLimiter` | FIFO semaphore | Parallel API calls |

---

## Daemon Management

### `daemon-spawn.ts`
Central daemon spawner. All spawn as **detached background processes** with log file redirect.

| Function | Daemon | Command |
|----------|--------|---------|
| `spawnMonitorFromState()` | BalanceMonitor | `0g-compute monitor start --from-state` |
| `spawnBotDaemon()` | MarketMaker | `marketmaker start` |
| `spawnClaudeProxy()` | Claude proxy | `echo claude proxy --daemon-child` |
| `spawnLauncher()` | Web dashboard | `echo launcher --daemon-child` |

Each checks `isDaemonAlive(pidFile)` before spawning (no duplicates).

### `daemon-resurrect.ts`
Called from CLI `preAction` hook. For each registered daemon: if `shouldBeRunning()` && not alive → respawn. Never throws (non-blocking, best-effort).

---

## Other Utilities

| File | Purpose |
|------|---------|
| `canonicalJson.ts` | Deterministic JSON with sorted keys — **must match slop-backend** for hash consistency |
| `legacy-cleanup.ts` | Removes old `echoclaw()` bash function from `~/.bashrc`/`~/.zshrc` (injected by old onboard). Idempotent. |
| `minimatch.ts` | Lightweight glob matcher (`*`, `?`, `**`) — no external dependency |

---

## Dependencies

| External | Used by |
|----------|---------|
| `winston` | logger.ts |
| `chalk` | ui.ts, banner.ts |
| `cli-table3` | ui.ts |
| `ora` | ui.ts (spinner) |

---

## Consumed by

Every module in the codebase. Key consumers:
- All commands → `respond`, `output`, `ui`, `validation`
- All API clients → `http`, `validation-helpers`, `rateLimit`
- Bot + launcher + update → `daemon-spawn`, `daemon-resurrect`
- Password/providers → `env`, `dotenv`
- Slop auth → `canonicalJson`

---

## Tests

```bash
npx vitest run src/__tests__/utils/
npx vitest run src/__tests__/config/   # dotenv, env-resolution overlap
npx vitest run src/__tests__/daemon/   # daemon spawn/resurrect
npx vitest run src/__tests__/onboard/  # banner
```

| File | Coverage |
|------|----------|
| `rateLimit.test.ts` | TokenBucket acquire/refill, ConcurrencyLimiter FIFO |
| `validation-helpers.test.ts` | Field validator factory, type guards |
| `bridge-amount-conversion.test.ts` | parseUnits sanity |
| `daemon-resurrect.test.ts` | Resurrection logic, shouldBeRunning guards |
| `daemon-spawn.test.ts` | Detached spawn, PID detection |
| `dotenv.test.ts` | .env read/write/load |
| `banner.test.ts` | Banner render |
