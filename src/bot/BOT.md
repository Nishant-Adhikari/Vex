# Bot — Real-time Trading Daemon

> Automated trading on Slop.money bonding curves. Trigger-based orders, WebSocket price feed, sequential tx execution, file-based persistence.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/bot/
  types.ts          — All domain types: TokenUpdate, Trigger, BotOrder, SizeSpec, notifications
  orders.ts         — Order CRUD (atomic file persistence, JSON, tmp+rename pattern)
  triggers.ts       — Pure-function trigger evaluation (no side effects)
  executor.ts       — On-chain trade execution (buy/sell on Slop bonding curves via viem)
  nonce-queue.ts    — FIFO sequential task queue (prevents nonce collisions)
  daemon.ts         — Core daemon class: WS connect → trigger eval → enqueue trade → notify
  stream.ts         — TokenStream: Socket.IO wrapper for slop-backend WS (auto-reconnect)
  state.ts          — Runtime state persistence (execution log, daily spend, hourly tx count)
  notify.ts         — Notification channels (slop chat via Socket.IO, OpenClaw webhooks)
```

---

## How It Works

```
slop-backend WS (token_update)
  │
  ▼
TokenStream (stream.ts) ── auto-reconnect, re-subscribe
  │
  ▼
BotDaemon.onTokenUpdate()
  ├── getArmedOrdersForToken()
  ├── evaluateTrigger() ── pure function, no side effects
  ├── checkGuardrails() ── slippage cap
  ├── cooldown check ── per-order, in-memory Map
  └── nonceQueue.enqueue() ── sequential tx execution
        │
        ▼
      executeTrade()
        ├── resolveSize() ── absolute / percent / all
        ├── executeBuy() or executeSell() ── on-chain via viem
        ├── markFilled() / markFailed()
        ├── logExecution() ── ring buffer (max 1000)
        └── notify() ── stdout JSON + slop chat + webhook
```

---

## Order Lifecycle

```
armed → executing → filled
                  → failed
armed → cancelled (user)
armed → disarmed (user) → armed (re-arm)
```

- Orders persist in `~/.echoclaw/bot/orders.json` (atomic write: tmp + rename)
- State (execution log, daily spend) in `~/.echoclaw/bot/state.json`

---

## Trigger Types

| Trigger | Fires when | Key params |
|---------|-----------|------------|
| `onNewBuy` | New buy trade on token | `ignoreWallet?`, `minAmountOg?` |
| `onNewSell` | New sell trade on token | `ignoreWallet?`, `minAmountOg?` |
| `priceAbove` | Token price >= threshold | `threshold` |
| `priceBelow` | Token price <= threshold | `threshold` |
| `bondingProgressAbove` | Bonding progress >= threshold | `threshold` |

Anti-duplicate: `onNewBuy`/`onNewSell` track `lastProcessedTxHash` per order to prevent re-firing on the same trade. On daemon start, snapshots seed this value.

---

## Size Modes

| Mode | Behavior |
|------|----------|
| `absolute` | Fixed 0G amount (`amountOg` wei) |
| `absoluteTokens` | Fixed token amount (`amountTokens` wei) |
| `percent` | % of wallet balance (buy: 0G balance minus gas reserve; sell: token balance) |
| `all` | Sell entire token balance |

---

## Executor

`executor.ts` handles on-chain interaction with Slop bonding curve contracts:

- Validates token via registry (`isValidToken`)
- Checks not graduated, trading enabled
- Calculates quote with partial fill awareness (graduation cap)
- Applies slippage protection
- Signs and broadcasts via viem `writeContract`

Dependencies: `tools/slop/quote.ts` (math), `tools/slop/abi/` (contract ABIs), `tools/wallet/` (signing client).

---

## Daemon Lifecycle

1. Check PID file (stale detection, single-instance guard)
2. Load armed orders, group by token
3. Connect `TokenStream` to slop-backend WS
4. Subscribe to all tokens with armed orders
5. Register `SIGINT`/`SIGTERM` + file-based shutdown watcher (Windows)
6. On shutdown: drain NonceQueue (30s timeout), disconnect stream, clean PID file

---

## Notifications

| Channel | Transport | When |
|---------|-----------|------|
| stdout | JSON line | Always (every event) |
| Slop chat | Socket.IO (`chat:send`) | BUY_FILLED, SELL_FILLED, TRADE_FAILED |
| OpenClaw webhook | HTTP POST | All events (if `OPENCLAW_WEBHOOK_URL` set) |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `tools/slop/quote.ts` | `calculateTokensOut`, `calculateOgOut`, `calculatePartialFill`, `applySlippage` |
| `tools/slop/abi/` | `SLOP_TOKEN_ABI`, `SLOP_REGISTRY_ABI` |
| `tools/slop/auth.ts` | `requireSlopAuth` (JWT for chat notifications) |
| `tools/wallet/client.ts` | `getPublicClient` (viem read) |
| `tools/wallet/signingClient.ts` | `getSigningClient` (viem write) |
| `tools/wallet/auth.ts` | `requireWalletAndKeystore` |
| `config/store.ts` | `loadConfig` (chain, services URLs) |
| `config/paths.ts` | `BOT_DIR`, `BOT_ORDERS_FILE`, `BOT_STATE_FILE`, `BOT_PID_FILE`, `BOT_SHUTDOWN_FILE` |
| `openclaw/hooks-client.ts` | `postWebhookNotification` |
| `errors.ts` | `EchoError`, `ErrorCodes` |

---

## CLI Entry Point

Daemon is started via `commands/marketmaker/daemon.ts` → `BotDaemon.start()`. Order CRUD via `commands/marketmaker/order.ts`.

---

## Tests

```bash
npx vitest run src/__tests__/bot/
```

| File | Coverage |
|------|----------|
| `bot-nonce-queue.test.ts` | Sequential execution, error isolation, drain timeout |
| `bot-orders.test.ts` | CRUD, state transitions, listing/filtering |
| `bot-triggers.test.ts` | All 5 trigger types, anti-duplicate, edge cases |
