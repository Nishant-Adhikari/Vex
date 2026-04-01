# Inspect Views — Trade Data Storage & Retrieval

> How Echo Agent stores, indexes, and exposes trade data for self-inspection.
>
> **Last updated: 2026-04-01**

---

## Architecture

```
Handler execution → _tradeCapture
        │
        ▼
  protocol_executions (immutable audit trail)
  protocol_capture_items (per-trade fan-out)
        │
        ▼
  proj_activity (normalized event + valuation snapshot)
        │
        ├──► proj_pnl_lots (FIFO inventory ledger)
        │         │
        │         └──► proj_pnl_matches (realized PnL per lot match)
        │
        ├──► proj_open_positions (prediction/order/LP lifecycle + MTM)
        │
        └──► [no write] bridge/lend/wrap/reward → audit-only rows

  proj_balances (Khalani current prices — for unrealized calculation)
```

Every trade goes through one pipeline. No separate logging. The agent reads its own state from projection tables, not from external APIs.

---

## Data Flow: What Happens When Agent Trades

### 1. Capture (runtime.ts)

Handler returns `_tradeCapture` with:
- **Identity**: `type`, `chain`, `instrumentKey`, `positionKey`, `walletAddress`
- **Amounts**: `inputAmount`, `outputAmount` (raw atomic units)
- **Valuation**: `inputValueUsd`, `outputValueUsd`, `unitPriceUsd`, `valuationSource`
- **Benchmark**: `benchmarkAssetKey`, `settlementAssetKey`, `inputValueNative`, `outputValueNative`
- **Meta**: `contracts` (predictions), `tokenId` (Polymarket), handler-specific data

Validator checks: required fields present, type matches MUTATION_MATRIX, valuation present for "exact" handlers, meta.contracts for prediction buy.

### 2. Persist (capture-pipeline.ts)

- `protocol_executions` — 1 row per tool call (immutable, never modified)
- `protocol_capture_items` — N rows for batch operations (predict.closeAll, limitOrder.batchFill)

### 3. Project (activity-populator.ts → position-projector.ts)

`proj_activity` — normalized event with all valuation fields. One row per trade item.

Then dispatched by `productType`:

| Product | What happens | Table |
|---------|-------------|-------|
| **spot** buy | Open FIFO lot with `costBasisUsd`, `costBasisNative` | `proj_pnl_lots` |
| **spot** sell | Transactional FIFO reduce (FOR UPDATE) + match record per lot consumed | `proj_pnl_lots` + `proj_pnl_matches` |
| **prediction** open | Upsert position with `entryPriceUsd`, `contracts`, `notionalUsd` | `proj_open_positions` |
| **prediction** close | Close position, null MTM fields | `proj_open_positions` |
| **order** open/cancel/fill | Lifecycle tracking | `proj_open_positions` |
| **lp** zap-in/out/migrate | Lifecycle tracking | `proj_open_positions` |
| **bridge/lend/wrap/reward** | No projection — audit-only in `proj_activity` | — |

### 4. Mark-to-Market (mtm.ts)

After balance sync, `refreshPredictionMtm()` updates open predictions:
- Jupiter: `sellYesPriceUsd` / `sellNoPriceUsd` (exit price)
- Polymarket: public `SELL` price from CLOB
- SQL: `current_value_usd = contracts * markPrice`, `unrealized_pnl_usd = current_value - notional`

---

## The 14 Views — What Agent Can Read

### Trading Family (`trading.ts`)

| View | Function | What it returns | Filters |
|------|----------|----------------|---------|
| `lots` | `inspectLots()` | FIFO lot ledger — open/partial/closed lots with cost basis (USD + native), quantity, benchmark | `instrumentKey`, `namespace`, `status` |
| `profits` | `inspectProfits()` | Realized PnL aggregated per instrument or per namespace. Includes matched count, shortfall count, native PnL | `walletAddress`, `namespace`, `instrumentKey`, `groupBy` |
| `unrealized` | `inspectUnrealized()` | Spot unrealized PnL per instrument. Joins lots × current prices from `proj_balances`. CTE with pro-rata remaining cost basis | `namespace` |

**How `profits` works internally:**
```sql
SELECT instrument_key,
       SUM(realized_pnl_usd) FILTER (WHERE match_kind = 'matched'),
       SUM(cost_basis_usd), SUM(proceeds_usd),
       SUM(realized_pnl_native), MAX(benchmark_asset_key)
FROM proj_pnl_matches
GROUP BY instrument_key
```

**How `unrealized` works internally:**
1. Aggregate open lots per instrument (remaining quantity, remaining cost basis)
2. For each instrument: parse `instrumentKey` → extract `tokenAddress`
3. Lookup current `price_usd` from `proj_balances` (Khalani)
4. `currentValue = remainingQty × currentPrice`
5. `unrealizedPnl = currentValue - remainingCostBasis`

### Position Family (`positions.ts`)

| View | Function | What it returns | Filters |
|------|----------|----------------|---------|
| `open_positions` | `inspectOpenPositions()` | All open positions with MTM data (`currentValue`, `unrealizedPnl`), entry price, contracts, settlement asset | `namespace` |
| `closed_positions` | `inspectClosedPositions()` | Historical positions (closed/cancelled/filled) with entry economics | `namespace` |
| `orders` | `inspectOrders()` | Limit order lifecycle (open/cancelled/filled) | `namespace`, `status` |

### Activity Family (`activity.ts`)

| View | Function | What it returns | Filters |
|------|----------|----------------|---------|
| `activity` | `inspectActivity()` | Full activity feed with valuation (`inputValueUsd`, `outputValueUsd`, `valuationSource`) | `namespace`, `productType`, `limit` |
| `bridges` | `inspectBridges()` | Bridge transaction history (input/output tokens and amounts) | `namespace`, `limit` |
| `lp_history` | `inspectLpHistory()` | LP zap-in/out/migrate events with pool metadata | `namespace`, `limit` |
| `non_trading_history` | `inspectNonTradingHistory()` | Audit history for lend/wrap/allowance/reward/stake | `namespace`, `limit` |

### Portfolio Family (`portfolio.ts`)

| View | Function | What it returns | Filters |
|------|----------|----------------|---------|
| `summary` | `inspectSummary()` | Total balance, open position count, realized PnL (from matches), unrealized PnL (MTM + spot), latest snapshot | — |
| `balances` | `inspectBalances()` | Aggregate USD total from `proj_balances` | — |
| `snapshots` | `inspectSnapshots()` | Portfolio time-series (7d) with PnL delta vs previous | — |
| `executions` | `inspectExecutions()` | Raw audit trail of every mutating tool call | `namespace`, `limit` |

**How `summary` aggregates unrealized:**
1. Prediction unrealized: `SUM(unrealized_pnl_usd)` from `proj_open_positions` where MTM has run
2. Spot unrealized: CTE joining `proj_pnl_lots` × `proj_balances` (same logic as `unrealized` view)
3. Total = prediction + spot (null if neither available)

---

## Database Tables Used

| Table | Purpose | Key indexes |
|-------|---------|-------------|
| `protocol_executions` | Immutable audit trail of every mutating call | `(namespace, created_at)`, `(tool_id)`, `external_refs GIN` |
| `protocol_capture_items` | Per-trade items within batch operations | `(execution_id)` |
| `proj_activity` | Normalized events + valuation snapshot | `(namespace)`, `(instrument_key)`, `(position_key)`, `(execution_id)` |
| `proj_pnl_lots` | FIFO inventory ledger | `(instrument_key, wallet_address, status)` |
| `proj_pnl_matches` | Realized PnL per FIFO lot match | `(instrument_key, wallet_address)`, `(sell_activity_id)` |
| `proj_open_positions` | Prediction/order/LP lifecycle + MTM | `(namespace, position_type, external_id)`, `(instrument_key)` |
| `proj_balances` | Current token balances + prices from Khalani | `(wallet_address, chain_id, token_address)` UNIQUE |
| `proj_portfolio_snapshots` | Portfolio value time-series | `(created_at DESC)` |

---

## Valuation Coverage

| Namespace | USD valuation | Native benchmark | Settlement |
|-----------|:------------:|:----------------:|:----------:|
| Jupiter spot | exact (`inUsdValue`/`outUsdValue`) | SOL when SOL is one leg | SOL/USDC/USDT from classifier |
| KyberSwap | exact (`amountInUsd`/`amountOutUsd`) | chain native when native leg | non-instrument token |
| Jaine | none (honest null) | 0G when w0G is one leg | trade-specific |
| Slop | none (honest null) | always 0G (bonding curve) | always 0G |
| Jupiter prediction | exact (`orderCostUsd`, `newAvgPriceUsd`) | — | USDC |
| Polymarket matched | exact (`price × amount`) | — | USDC |

---

## Precision Model

- Handler → `_tradeCapture`: USD as **string** (preserves source precision)
- `proj_activity` columns: **NUMERIC** (Postgres arbitrary precision)
- FIFO pro-rata math: **SQL-side** (`cost_basis_usd * matched_qty / quantity_raw`)
- MTM: **SQL-side** (`contracts * $markPrice::numeric`)
- Presentation (`inspect-views/*.ts`): `Number()` only here — display layer
