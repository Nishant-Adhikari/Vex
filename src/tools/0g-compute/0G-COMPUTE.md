# 0G Compute — Inference Network Integration

> SDK wrapper and operations layer for the 0G Compute Network. Manages on-chain ledger, provider sub-accounts, API keys, pricing heuristics, readiness checks, and BalanceMonitor daemon. Uses `@0glabs/0g-serving-broker` SDK under the hood.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/tools/0g-compute/
  constants.ts          — Path constants (PID, state, log files for monitor + compute)
  helpers.ts            — Shared validation (address, amount, tokenId), bigint serialization, token redaction
  account.ts            — Normalize SDK structs: ledger, sub-account, infer-tuples (bigint → OG-denominated)
  pricing.ts            — Provider pricing heuristics: recommended min balance, per-1M-token cost
  bridge.ts             — withSuppressedConsole() — suppresses SDK console.log pollution
  broker-factory.ts     — Cached authenticated broker (SDK + wallet + RPC chainId verification)
  readiness.ts          — 6-step readiness check (wallet, broker, ledger, sub-account, ACK, OpenClaw config)
  operations.ts         — Thin SDK wrappers: deposit, fund, ACK, API key, OpenClaw config patching
  monitor.ts            — BalanceMonitor daemon (polls sub-accounts, webhook alerts on low balance)
  monitor-lifecycle.ts  — Monitor daemon lifecycle helpers (start/stop/PID, provider tracking)
  smoke-test.ts         — Standalone E2E test script (wallet → broker → list → ledger → API key → inference)
```

---

## Architecture

```
@0glabs/0g-serving-broker SDK
  │
  ▼
broker-factory.ts (cached, per-process singleton)
  ├── Wallet key from Echo keystore
  ├── RPC URL from config
  └── ChainId verification (16661 = 0G Mainnet)
        │
        ▼
      operations.ts (thin wrappers, no CLI output)
        ├── Ledger: deposit, getBalance, hasLedger
        ├── Provider: fund, ACK, getSubAccount, getServiceMetadata
        ├── API key: create (tokenId, never-expires)
        └── OpenClaw: configureOpenclawProvider (models.providers.zg)
```

All SDK calls wrapped in `withSuppressedConsole()` — SDK prints "Detected network: ..." to stdout which breaks JSON mode.

---

## Readiness Check (`readiness.ts`)

`checkComputeReadiness()` — single source of truth for "is 0G Compute ready?"

6 checks in order (fails fast on first failure):

| # | Check | What it verifies |
|---|-------|-----------------|
| 1 | `wallet` | Keystore exists + password decrypts |
| 2 | `broker` | SDK initializes + RPC responds |
| 3 | `ledger` | On-chain ledger exists |
| 4 | `subAccount` | Provider has sufficient locked balance (>= pricing-derived minimum) |
| 5 | `ack` | Provider signer acknowledged |
| 6 | `openclawConfig` | `models.providers.zg` in openclaw.json with baseUrl + apiKey |

Provider recovery chain (if not in compute-state.json):
1. `compute-state.json` → `activeProvider`
2. Ledger detail → first sub-account with lockedOg > 0
3. OpenClaw config `baseUrl` → match against service endpoints

State persisted in `~/.echoclaw/0g-compute/compute-state.json`.

---

## Account Normalization (`account.ts`)

SDK returns both tuple-indexed and named-property structs. These helpers normalize to simple OG-denominated objects:

| Function | Input | Output |
|----------|-------|--------|
| `normalizeSubAccount(account)` | SDK `AccountStructOutput` | `{ totalOg, pendingRefundOg, lockedOg, rawBalance, rawPendingRefund }` |
| `normalizeLedger(ledger)` | SDK `LedgerStructOutput` | `{ availableOg, totalOg, reservedOg }` |
| `normalizeLedgerDetail(info)` | `getLedgerWithDetail()` array | `{ availableOg, totalOg, reservedOg }` |
| `normalizeInferTuple(tuple)` | `[provider, balance, pendingRefund]` | `{ provider } & NormalizedSubAccount` |

---

## Pricing (`pricing.ts`)

SDK prices are **per token in neuron** (1 0G = 10^18 neuron).

```
costNeuron = tokenBudget × (inputPrice + outputPrice)
recommendedMinLockedOg = max(1.0, formatUnits(costNeuron, 18))
recommendedAlertLockedOg = recommendedMin × alertRatio (default 1.2)
```

Default token budget: 2M tokens (matches SDK `topUpTargetThreshold`).

`formatPricePerMTokens(priceNeuron)` — display as "X.XXXX 0G / 1M tokens".

---

## BalanceMonitor (`monitor.ts`)

Daemon that polls sub-account balances and sends webhook alerts.

### Modes

| Mode | Threshold source |
|------|-----------------|
| `fixed` | User-supplied static threshold |
| `recommended` | Dynamic from provider pricing + buffer + alertRatio |

### Lifecycle

Same pattern as BotDaemon:
1. Write PID file (single-instance guard)
2. Poll immediately, then schedule recurring (min 60s interval)
3. Signal handlers: SIGINT/SIGTERM + shutdown file watcher (Windows)
4. Clean PID + shutdown files on exit

### Anti-spam

- 1h cooldown between alerts for same provider
- Re-alert if balance dropped another 50% since last alert

### Alerts

Via OpenClaw webhook (`POST /hooks/agent`):
- 1 retry on network error
- 10s timeout per request
- Logs routing flags for diagnostics

---

## Operations (`operations.ts`)

Zero CLI output — callers handle UI:

| Function | What it does |
|----------|-------------|
| `listChatServices(broker)` | Filter services by `serviceType === "chatbot"` |
| `depositToLedger(broker, amount)` | `addLedger` (first time) or `depositFund` |
| `getLedgerBalance(broker)` | Normalized ledger balance |
| `fundProvider(broker, provider, amount)` | `transferFund` to inference sub-account |
| `getSubAccountBalance(broker, provider)` | Normalized sub-account |
| `ackProviderSigner(broker, provider)` | Acknowledge signer |
| `ackWithReadback(broker, provider)` | ACK + poll confirmation (120s timeout) |
| `createApiKey(broker, provider, tokenId?)` | Create API key (never-expires) |
| `configureOpenclawProvider(broker, provider, apiKey)` | Patch openclaw.json + save compute state |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `@0glabs/0g-serving-broker` | 0G SDK (broker, ledger, inference) |
| `ethers` | `formatUnits` for bigint → OG conversion |
| `viem` | Address validation, `parseUnits` |
| `config/store.ts` | `loadConfig()` — chain RPC URL |
| `config/paths.ts` | `CONFIG_DIR` |
| `constants/chain.ts` | `CHAIN.chainId` for RPC verification |
| `bot/executor.ts` | `requireWalletAndKeystore()` |
| `openclaw/config.ts` | `patchOpenclawConfig()`, `loadOpenclawConfig()` |
| `openclaw/hooks-client.ts` | `loadHooksConfig()` for webhook alerts |
| `utils/logger.ts` | Structured logging |
| `utils/output.ts` | `isHeadless()` for console suppression |

---

## CLI Entry Point

`commands/0g-compute/` — setup, providers, ledger, provider, api-key, monitor subcommands.

---

## Tests

```bash
npx vitest run src/__tests__/0g/
```

| File | Coverage |
|------|----------|
| `0g-compute-command-tree.test.ts` | Command registration |
| `0g-compute-helpers.test.ts` | Account normalization, pricing, bigint serialization |
| `0g-compute-operations.test.ts` | Ledger deposit/fund, provider ACK, API key |
| `0g-compute-readiness.test.ts` | State load/save, full readiness check |
