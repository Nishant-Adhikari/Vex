# Claude — Anthropic-to-OpenAI Translation Proxy

> Local HTTP proxy that lets Claude Code talk to 0G Compute broker. Accepts Anthropic Messages API, translates to OpenAI `/chat/completions`, forwards upstream, translates response back. Supports streaming (SSE) and non-streaming.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/claude/
  constants.ts    — Paths (PID, log, config backup), default port (4101), model label helper
  proxy.ts        — HTTP server: route handling, upstream fetch, SSE stream relay, PID management
  translate.ts    — Pure Anthropic <-> OpenAI translation (no I/O, separately testable)
```

---

## How It Works

```
Claude Code (Anthropic Messages API)
  │
  POST /v1/messages
  │
  ▼
proxy.ts (http://127.0.0.1:4101)
  ├── Parse Anthropic request
  ├── Resolve model (alias → configured model)
  ├── translateRequest() ── Anthropic → OpenAI format
  ├── fetch upstream (0G broker /chat/completions)
  │     Auth: Bearer ZG_CLAUDE_AUTH_TOKEN
  │
  ├── Non-stream: translateResponse() ── OpenAI → Anthropic
  └── Stream: translateStreamChunk() per SSE line ── OpenAI SSE → Anthropic SSE
```

---

## Routes

| Method | Path | Handler |
|--------|------|---------|
| `POST` | `/v1/messages` | Main translation proxy (stream + non-stream) |
| `POST` | `/v1/messages/count_tokens` | Token count estimation (local, no upstream call) |
| `GET` | `/health` | Provider, model, auth status |

---

## Translation Layer (`translate.ts`)

Pure functions, zero I/O. Handles:

**Request (Anthropic → OpenAI):**
- `system` (string or block array) → OpenAI `system` message
- `messages` with mixed content blocks → flattened OpenAI messages
- `tool_use` blocks → OpenAI `tool_calls` on assistant messages
- `tool_result` blocks → OpenAI `tool` role messages
- `tools` → OpenAI function definitions
- `tool_choice` mapping: `auto`→`auto`, `any`→`required`, `none`→`none`, `tool`→named function

**Response (OpenAI → Anthropic):**
- `finish_reason` mapping: `stop`→`end_turn`, `length`→`max_tokens`, `tool_calls`→`tool_use`
- `tool_calls` → `tool_use` content blocks with parsed JSON input
- Usage: `prompt_tokens`→`input_tokens`, `completion_tokens`→`output_tokens`

**Streaming:**
- `StreamState` tracks: message ID, content block indexes, active tool calls, accumulated arguments
- Each OpenAI SSE chunk → 0..N Anthropic SSE events (`message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`)
- `finalizeStream()` closes any open blocks when `[DONE]` arrives without explicit `finish_reason`
- Tool call arguments accumulated across chunks, emitted as `input_json_delta`

**Token estimation:**
- `estimateTokenCount()` — heuristic (~chars/3 + overhead), no upstream call
- Used by `/v1/messages/count_tokens` endpoint

---

## Model Resolution

```
requestedModel → resolveClaudeModel(requested, configured)
  ├── "sonnet" / "opus" / "haiku" (alias) → configured model
  ├── branded label ("0G-<model>")        → configured model
  └── anything else                       → pass-through as-is
```

---

## Configuration

Reads from `config.claude` (set via `echoclaw echo claude config`):

| Field | Purpose |
|-------|---------|
| `provider` | Provider identifier |
| `model` | Model name for upstream |
| `providerEndpoint` | 0G broker base URL |
| `proxyPort` | Listen port (default: 4101) |

Auth token from `ZG_CLAUDE_AUTH_TOKEN` env var.

---

## Timeouts & Limits

| Setting | Value |
|---------|-------|
| Stream timeout | 5 min |
| Non-stream timeout | 2 min |
| Max request body | 10 MB |
| Bind address | `127.0.0.1` only |

Client disconnect aborts upstream fetch (via `AbortController`).

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `config/store.ts` | `loadConfig()` — claude proxy settings |
| `config/paths.ts` | `CONFIG_DIR` |
| `utils/logger.ts` | Structured logging |

---

## CLI Entry Points

- `commands/claude/proxy-cmd.ts` → `startProxyServer()` / `cleanupPidFile()`
- `commands/claude/config-cmd.ts` → configure provider/model/endpoint
- `commands/claude/setup-cmd.ts` → interactive setup wizard

---

## Tests

```bash
npx vitest run src/__tests__/claude/
```

| File | Coverage |
|------|----------|
| `claude-command.test.ts` | Command tree structure |
| `claude-config.test.ts` | Settings injection/removal |
| `claude-proxy.test.ts` | HTTP route handling, model resolution |
| `claude-translate.test.ts` | Request/response translation, streaming, token estimation |
