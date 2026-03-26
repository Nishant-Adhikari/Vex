# Solana Module Map — Portfolio Data Sources & Transaction History

This document maps every `.ts` file in `src/tools/chains/solana/` to the data it provides for wallet portfolio tracking, transaction history, and UI/UX.

---

## Transaction History Sources (by domain)

### Spot (Swaps & Transfers)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `jupiter-client.ts` | `jupiterGetSpotHistory(params)` | Swap trades: buy/sell type, USD volume, profit, cost, price, amount, txHash, blockTime | `GET /_datapi/v1/txs/users` |
| `swap-service.ts` | `executeSwap()` | Single swap result: signature, explorerUrl, inputAmount, outputAmount | Ultra `/order` + `/execute` |
| `transfer-service.ts` | `sendSol()` / `sendSplToken()` | Transfer result: signature, explorerUrl | RPC `sendRawTransaction` |
| `send-service.ts` | `craftSend()` | Send-invite result: inviteCode, signature, explorerUrl | `POST /send/v1/craft-send` |
| `send-service.ts` | `craftClawback()` | Clawback result: signature, explorerUrl | `POST /send/v1/craft-clawback` |

**Preview before execution**: `getSwapQuote()` from `swap-service.ts` — returns quote without executing (input/output amounts, price impact, route, slippage). Essential for confirmation UI.

**Best for UI history tab**: `jupiterGetSpotHistory` — paginated, filterable by token/date, includes P&L per trade. Double-bookkeeping entries grouped by txHash.

### Perps (Leveraged Trading)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `perps-client.ts` | `perpsGetTrades(params)` | Trade history: action (Increase/Decrease), side (long/short), price, size, PnL, pnlPercentage, fee, txHash, createdTime | `GET perps-api.jup.ag/v2/trades` |
| `perps-service.ts` | `openPerpsPosition()` | Open result: positionPubkey, signature, type (market/limit), quote | `POST /positions/increase` |
| `perps-service.ts` | `closePerpsPosition()` | Close result: signature, quote (PnL, fees, received) | `POST /positions/decrease` |
| `perps-service.ts` | `closeAllPerpsPositions()` | Batch close: array of signatures | `POST /positions/close-all` |

**Best for UI history tab**: `perpsGetTrades` — filterable by asset/side/action/date, includes realized PnL per trade.

### Predictions (Binary Markets)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `prediction-service.ts` | `getPredictHistory(address, opts)` | History: eventType, side (yes/no), action (buy/sell), contracts, avgPriceUsd, realizedPnl, signature | `GET /prediction/v1/history` |
| `prediction-service.ts` | `createPredictOrder()` | Order result: signature, positionPubkey | `POST /prediction/v1/orders` |
| `prediction-service.ts` | `claimPosition()` | Claim result: signature, explorerUrl | `POST /positions/{pubkey}/claim` |
| `prediction-service.ts` | `closePosition()` | Close result: signature, explorerUrl | `DELETE /positions/{pubkey}` |

**Single lookups**: `getPosition(pubkey)` — single position detail. `getEvent(eventId)` — single event with markets. `searchEvents(query)` — keyword search.

**Best for UI history tab**: `getPredictHistory` — paginated, includes event types (order_filled, position_lost, payout_claimed).

### DCA & Limit Orders

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `order-service.ts` | `createDcaOrder()` | DCA created: orderKey, signature | `POST /recurring/v1/createOrder` |
| `order-service.ts` | `cancelDcaOrder()` | DCA cancelled: signature | `POST /recurring/v1/cancelOrder` |
| `order-service.ts` | `createLimitOrder()` | Limit created: orderKey, signature | `POST /trigger/v1/createOrder` |
| `order-service.ts` | `cancelLimitOrder()` | Limit cancelled: signature | `POST /trigger/v1/cancelOrder` |

**Note**: No dedicated history endpoint for DCA/limit — individual transaction signatures can be tracked via Solana explorer.

### Staking

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `stake-service.ts` | `createAndDelegateStake()` | Stake created: stakeAccount, signature, explorerUrl | RPC (StakeProgram) |
| `stake-service.ts` | `withdrawStake()` | Withdraw: signature, explorerUrl | RPC (StakeProgram) |
| `stake-service.ts` | `claimMev()` | MEV claimed: array of {stakeAccount, claimedSol, signature} | RPC (StakeProgram) |

### Lending

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `lend-service.ts` | `lendDeposit()` | Deposit: signature, explorerUrl | `POST /lend/v1/earn/deposit` |
| `lend-service.ts` | `lendWithdraw()` | Withdraw: signature, explorerUrl | `POST /lend/v1/earn/withdraw` |

### Studio (Token Creation)

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `studio-service.ts` | `studioCreateToken()` | Token created: mint, signature, explorerUrl | `POST /studio/v1/dbc-pool/create-tx` |
| `studio-service.ts` | `studioClaimFees()` | Fees claimed: signature, explorerUrl | `POST /studio/v1/dbc/fee/create-tx` |

### Account Management

| Source | Function | Returns | Endpoint |
|--------|----------|---------|----------|
| `account-service.ts` | `burnSplToken()` | Burn: signature, explorerUrl | RPC (createBurnInstruction) |
| `account-service.ts` | `closeEmptyAccounts()` | Closed: count, rentReclaimedSol, signatures | RPC (createCloseAccountInstruction) |

---

## Portfolio Balance Sources

### Token Holdings

| Source | Function | What it returns |
|--------|----------|-----------------|
| `jupiter-client.ts` | `jupiterHoldings(address)` | SOL native balance + all SPL token accounts with amounts, decimals, frozen status, ATA flag |
| `jupiter-client.ts` | `jupiterGetPrices(mints)` | Real-time USD price per token mint |
| `jupiter-client.ts` | `jupiterShield(mints)` | Security warnings per token (severity: info/warning/critical) |
| `jupiter-client.ts` | `jupiterSearchTokens(query)` | Token metadata: name, symbol, icon, decimals, tags |

**Token resolution**: `resolveToken(symbolOrMint)` from `token-registry.ts` — resolves symbol or mint → full metadata (chain: well-known → file cache → Jupiter API). `resolveTokens(queries)` for batch.

**Portfolio value**: `jupiterHoldings(address)` → extract mints → `jupiterGetPrices(mints)` → multiply balances × prices.

### Open Positions (Locked Value)

| Domain | Source | Function | Data |
|--------|--------|----------|------|
| **Perps** | `perps-client.ts` | `perpsGetPositions(wallet)` | Open leveraged positions: side, leverage, sizeUsd, entryPrice, markPrice, PnL, liquidationPrice, TP/SL |
| **Perps** | `perps-client.ts` | (included above) | Pending limit orders: side, sizeUsd, triggerPrice |
| **Predictions** | `prediction-service.ts` | `getPositions(address)` | YES/NO contracts: contracts count, totalCostUsd, valueUsd, pnlUsd, claimable flag |
| **Lending** | `lend-service.ts` | `getLendPositions(address)` | Deposited tokens: shares, underlyingAssets, underlyingBalance |
| **Lending** | `lend-service.ts` | `getLendEarnings(address, positions)` | Accrued earnings per position |
| **DCA** | `order-service.ts` | `listDcaOrders(wallet)` | Active DCA orders: inAmountPerCycle, inDeposited, inUsed, outReceived |
| **Limits** | `order-service.ts` | `listLimitOrders(wallet)` | Pending trigger orders: makingAmount, takingAmount, remainingAmounts, status |
| **Staking** | `stake-service.ts` | `getStakeAccounts(wallet)` | Staked SOL: balance, status, validator, claimable MEV tips |
| **Invites** | `send-service.ts` | `getPendingInvites(address)` | Tokens locked in unclaimed send invites |
| **Studio** | `studio-service.ts` | `studioGetFees(mint)` | Unclaimed DBC trading fees (for token creators). Uses `studioGetPoolAddress(mint)` internally to resolve mint → pool address |

### Market Data

| Domain | Source | Function | Data |
|--------|--------|----------|------|
| **Perps** | `perps-client.ts` | `perpsGetMarkets()` | SOL/BTC/ETH: price, 24h change, high/low, volume |
| **Tokens** | `jupiter-client.ts` | `jupiterGetTrendingTokens()` | Trending tokens with price, volume, buy/sell stats |
| **Lending** | `lend-service.ts` | `getLendRates()` | APY per token (supply + rewards), TVL, total supply |
| **Predictions** | `prediction-service.ts` | `listEvents()` / `getMarket()` | Events with YES/NO prices, volume, status |

---

---

## API Key Requirements

Jupiter API key (`echoclaw config set-jupiter-key <key>`, free from [portal.jup.ag](https://portal.jup.ag)).

| Feature | Without key (`lite-api.jup.ag`) | With key (`api.jup.ag`) |
|---------|-------------------------------|------------------------|
| **Swap** (Ultra order/execute) | Works (lower rate limits) | Works (higher rate limits) |
| **Token search/trending/price** | Works | Works |
| **Holdings / Shield** | Works | Works |
| **DCA** (Recurring API) | Works | Works |
| **Limit orders** (Trigger V1) | Works | Works |
| **Lend Earn** (deposit/withdraw/rates/positions/earnings) | Works | Works |
| **Predictions** (events/orders/positions/history) | Works | Works |
| **Send** (invite/clawback) | Works | Works |
| **Spot history** (Datapi) | Works | Works |
| **Perps** (`perps-api.jup.ag/v2`) | Works (separate host, key passed but not required) | Works |
| **Studio** (token creation, fees, claim) | **BLOCKED — returns 404** | **Required** |

**Summary**: Only Studio requires a key. Everything else works on `lite-api.jup.ag` without a key. With a key, all requests go to `api.jup.ag` which has higher rate limits (free tier: 60 req/min).

---

## Utility Files (no portfolio data)

| File | Role |
|------|------|
| `connection.ts` | Solana RPC connection singleton (lazy-init from config) |
| `constants.ts` | Well-known token mints: SOL, USDC, USDT, JUP, BONK, mSOL, jitoSOL, bSOL, ETH, wBTC, PYTH, JTO, WEN, RNDR, JLP |
| `token-registry.ts` | Token resolution chain: well-known → file cache → Jupiter Token API v2 |
| `token-cache.ts` | File-based token metadata cache with 24h TTL, atomic writes |
| `validation.ts` | Address validation, amount parsing (SOL/SPL), explorer URL builder, address shortener |
| `tx.ts` | Transaction primitives: deserialize, sign (multi-signer), send, confirm with polling, retry logic |

---

## UI/UX Dashboard Recipe

```
1. WALLET OVERVIEW
   jupiterHoldings(address) + jupiterGetPrices(mints)
   → token list sorted by USD value
   → jupiterShield(mints) for risk badges

2. OPEN POSITIONS panel
   perpsGetPositions(wallet)     → leveraged trades with live PnL
   getPositions(address)         → prediction contracts with PnL
   getLendPositions(address)     → lending deposits
   getLendEarnings(address, pos) → accrued interest
   listDcaOrders(wallet)         → active DCA schedules
   listLimitOrders(wallet)       → pending trigger orders
   getStakeAccounts(wallet)      → staked SOL + MEV
   getPendingInvites(address)    → locked send invites

3. TRANSACTION HISTORY tabs
   [Spot]        jupiterGetSpotHistory(params)  → swaps with P&L
   [Perps]       perpsGetTrades(params)         → leveraged trades with realized PnL
   [Predictions] getPredictHistory(address)     → prediction trades with realized PnL

4. MARKET DATA sidebar
   perpsGetMarkets()              → SOL/BTC/ETH live prices
   jupiterGetTrendingTokens()     → trending tokens
   getLendRates()                 → lending APYs
   listEvents()                   → prediction events
```
