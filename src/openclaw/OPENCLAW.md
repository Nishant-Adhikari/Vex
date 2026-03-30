# OpenClaw — Agent Gateway Integration

> Configuration management and webhook notifications for [OpenClaw](https://docs.openclaw.ai/) — the agent gateway that connects EchoClaw to messaging platforms (WhatsApp, Telegram, etc.) and provides skill hosting.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.
>
> **Docs:** https://docs.openclaw.ai/

---

## Directory Structure

```
src/openclaw/
  config.ts         — Read/write/patch openclaw.json (JSON5 input, JSON output, atomic write)
  hooks-client.ts   — Webhook notification client (POST /hooks/agent → messenger delivery)
```

---

## config.ts — OpenClaw Configuration

Manages `~/.openclaw/openclaw.json` — the OpenClaw agent gateway config file.

### Config path resolution

| Priority | Source | Path |
|----------|--------|------|
| 1 | `OPENCLAW_CONFIG_PATH` env | Full file path |
| 2 | `OPENCLAW_HOME` env | `$OPENCLAW_HOME/openclaw.json` |
| 3 | Fallback | `~/.openclaw/openclaw.json` |

### API

| Function | Purpose |
|----------|---------|
| `loadOpenclawConfig()` | Load config (JSON5 support: comments, trailing commas). Returns `null` if missing. |
| `patchOpenclawSkillEnv(skillKey, env, opts?)` | Set env vars at `skills.entries.<skillKey>.env`. Skips existing keys unless `force: true`. |
| `patchOpenclawConfig(dotPath, value, opts?)` | Generic deep-set at any dot-separated path. Supports `force` and `merge` (shallow-merge objects). |
| `removeOpenclawConfigKey(dotPath)` | Delete key at dot-separated path. Idempotent. |
| `getOpenclawHome()` | Resolve OpenClaw home directory. |
| `getSkillHooksEnv(skillKey?)` | Extract `OPENCLAW_HOOKS_*` env vars from skill config. |

### Write safety

- Reads JSON5 (comments, trailing commas)
- Writes standard JSON (JSON5 formatting lost — intentional)
- Atomic write: tmp file + `rename()` (crash-safe)
- File permissions: `0o600` (owner-only)
- Never logs secret values — only key names

---

## hooks-client.ts — Webhook Notifications

Sends trade events to OpenClaw Gateway at `POST /hooks/agent`, which delivers them to the user's connected messenger (WhatsApp, Telegram, etc.).

### Configuration (ENV vars)

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENCLAW_HOOKS_BASE_URL` | Yes | Gateway base URL |
| `OPENCLAW_HOOKS_TOKEN` | Yes | Auth bearer token |
| `OPENCLAW_HOOKS_AGENT_ID` | No | Target agent ID |
| `OPENCLAW_HOOKS_CHANNEL` | No | Delivery channel (WhatsApp, Telegram, etc.) |
| `OPENCLAW_HOOKS_TO` | No | Recipient identifier |
| `OPENCLAW_HOOKS_INCLUDE_GUARDRAIL` | No | Include guardrail events (`"1"` to enable) |

Webhook is **disabled** when `BASE_URL` or `TOKEN` is not set. Config is cached after first load.

### Event filtering

| Event | Sent via webhook |
|-------|-----------------|
| `BUY_FILLED` | Yes |
| `SELL_FILLED` | Yes |
| `TRADE_FAILED` | Yes |
| `GUARDRAIL_EXCEEDED` | Only if `INCLUDE_GUARDRAIL=1` |
| `BOT_STARTED` | No |
| `BOT_STOPPED` | No |

### Delivery

- Fire-and-forget: errors logged, never thrown
- 1 automatic retry on network/timeout errors (not on HTTP errors)
- 5s timeout per request
- Message truncated at 2048 chars

### Validation & dry-run

| Function | Purpose |
|----------|---------|
| `validateHooksTokenSync(skillKey?)` | Check if `hooks.token` matches `OPENCLAW_HOOKS_TOKEN` in skill env |
| `validateHooksRouting(config)` | Warn if `channel` or `to` not set |
| `buildMonitorAlertPayload(config, opts?)` | Simulate BalanceMonitor webhook payload (no send) |
| `buildMarketMakerPayload(config)` | Simulate MarketMaker BUY_FILLED payload (no send) |
| `sendTestWebhook(config, body)` | Actually send a test payload (used by `--probe-live`) |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `bot/types.ts` | `BotNotification` type |
| `errors.ts` | `EchoError`, `ErrorCodes` |
| `utils/logger.ts` | Structured logging |
| `json5` (npm) | JSON5 parsing for openclaw.json |

---

## Consumed by

- `commands/setup.ts` — OpenClaw linking, webhook configuration
- `commands/onboard/` — Setup wizard steps
- `launcher/handlers/openclaw.ts` — HTTP equivalents of onboard steps
- `bot/daemon.ts` — `postWebhookNotification()` on trade events

---

## Tests

```bash
npx vitest run src/__tests__/openclaw/
```

| File | Coverage |
|------|----------|
| `openclaw-config.test.ts` | Load/parse, JSON5 support, deep merge |
| `openclaw-config-patch.test.ts` | Skill env patching, generic deep-set, force/merge |
| `openclaw-hooks.test.ts` | Webhook formatting, event filtering, validation, dry-run payloads |
| `setup-openclaw-hooks.test.ts` | Hook setup flow |
