# E2E Test Scenario — Claude as Debugger

> Runbook for Claude testing Echo Agent persistence pipeline via local MCP.
> Real wallets, real funds, small notionals.
>
> **Last updated: 2026-03-31**

---

## What This Is

You (Claude) are connected to a local MCP server that exposes Echo Agent's tool surface over a test Postgres. Your job is to verify that the capture → projection pipeline works correctly for W4-relevant mutations.

## Available MCP Tools

| Tool | Purpose | When to use |
|------|---------|-------------|
| `echo_discover` | Search protocol capabilities | Find tools, check params |
| `echo_execute` | Execute a protocol tool | **Main tool for manual tests** |
| `echo_wallet_read` | Check wallet balances | Before/after each flow |
| `echo_portfolio_inspect` | DB-backed inspection: positions, activity, balances, snapshots | Quick overview. **Does NOT show lots.** |
| `echo_inspect_pipeline` | Read-only query on pipeline tables | Detailed inspection per table |
| `echo_replay_verify` | Replay projections and compare | After multi-namespace tests |
| `echo_discovery_smoke` | Automated discovery check | Verify all namespaces are active |
| `echo_preview_smoke` | Automated dryRun zero-write check | Verify previews don't write to DB |

## Safety Rules

1. **Max notional per transaction:** $5 USD equivalent (spot, prediction, bridge)
2. **Allowed namespaces:** khalani, kyberswap, solana, polymarket, jaine, slop
3. **STOP immediately if:** wallet balance drops unexpectedly, handler throws unexpected error, DB state is inconsistent
4. **Never** execute without checking `echo_wallet_read` first
5. **Never** execute the same mutation twice without inspecting DB state between

## Session Setup

1. **Reset DB** before each manual session (operator runs CLI, not you)
2. After reset: `initSync()` must be called to reseed sync jobs
3. Use consistent `sessionId` per session: e.g. `manual-2026-03-31-spot`
4. `echo_inspect_pipeline` filters by `executionId`, `toolId`, `positionKey` — use to track your steps
5. **`proj_open_positions` has no execution_id** — filter by `positionKey` or `namespace`

## Test Order

### 1. Preflight
- `echo_wallet_read` — confirm seed funds on each chain
- `echo_discovery_smoke` — all active namespaces return tools
- `echo_preview_smoke` — dryRun produces zero writes

### 2. Spot Flows (pnl_spot)
For each: execute buy → inspect DB → execute sell → inspect FIFO close

- `kyberswap.swap.buy` + `kyberswap.swap.sell`
- `jaine.swap.buy` + `jaine.swap.sell`
- `slop.trade.buy` + `slop.trade.sell`
- `solana.swap.execute` (classifySolanaSwap deterministic)

**DB check after buy:**
- `echo_inspect_pipeline proj_pnl_lots` — open lot with quantityRaw > 0

**DB check after sell:**
- `echo_inspect_pipeline proj_pnl_lots` — lot status partial/closed

### 3. Prediction Flows (pnl_prediction)
- `solana.predict.buy` → `echo_inspect_pipeline proj_open_positions` → `solana.predict.sell`
- `solana.predict.closeAll` — check _tradeCaptureItems count
- `polymarket.clob.buy` (matched) → dual-type "prediction" → position open
- `polymarket.clob.sell` (matched) → position close

### 4. Order Lifecycle (projection)
- `kyberswap.limitOrder.create` → open → `kyberswap.limitOrder.cancel` → close
- `kyberswap.limitOrder.hardCancel` — on-chain cancel
- `kyberswap.limitOrder.fill` — order filled
- `kyberswap.limitOrder.cancelAll` — bulk close, check _tradeCaptureItems
- `polymarket.clob.cancel` → single order cancel
- `polymarket.clob.cancelOrders` → bulk, check items
- `polymarket.clob.cancelAll` → bulk all

### 5. Audit Flows
- `khalani.bridge` — audit capture in protocol_executions
- `jaine.w0g.wrap` + `jaine.w0g.unwrap`
- `jaine.allowance.approve` + `jaine.allowance.revoke`
- `solana.lend.deposit` + `solana.lend.withdraw`
- `slop.fees.claimCreator`, `slop.reward.claim` (if applicable)

### 6. Cross-Protocol
- `slop.trade.buy` (0G token) → `jaine.swap.sell` (same token)
- Verify: `echo_inspect_pipeline proj_pnl_lots` — both lots share same `instrumentKey` (`0g:{addr}`)

### 7. Replay Closeout
- `echo_replay_verify` — audit trail intact, projections rebuilt, counts match

## Checklist Per Flow

After each mutating execution, check:

| Table | What to verify | Tool |
|-------|---------------|------|
| `protocol_executions` | Row exists, success=true, trade_capture present | `echo_inspect_pipeline protocol_executions` |
| `protocol_capture_items` | Item count matches fanOut (1 for single, N for batch) | `echo_inspect_pipeline protocol_capture_items` |
| `proj_activity` | productType, tradeSide, instrumentKey, positionKey correct | `echo_inspect_pipeline proj_activity` |
| `proj_open_positions` | Lifecycle: open/closed/cancelled (prediction, order, lp) | `echo_inspect_pipeline proj_open_positions` |
| `proj_pnl_lots` | Lot opened on buy, FIFO reduced on sell (spot only) | `echo_inspect_pipeline proj_pnl_lots` |

## Report Format

Per flow, report:

```
FLOW: kyberswap.swap.buy + sell
STATUS: PASS / FAIL / OPEN QUESTION
DETAILS: [what was observed]
DB STATE: [relevant rows from inspect_pipeline]
```

At the end:
```
REPLAY: PASS / FAIL
SUMMARY: X flows tested, Y passed, Z failed, W open questions
```
