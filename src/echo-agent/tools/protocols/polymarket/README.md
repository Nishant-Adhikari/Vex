# Polymarket Protocol — Echo Agent

69 tools across 4 API surfaces. All handlers import directly from `@tools/polymarket/` TS clients — no CLI spawning.

## API Key

Polymarket has two auth tiers:

| Feature | Without CLOB key | With CLOB key |
|---------|-----------------|---------------|
| Gamma (events, markets, search, tags, comments, profiles, sports) | Works | Works |
| Data (positions, activity, leaderboard, trades, holders, OI, volume) | Works | Works |
| Bridge (deposit, withdraw, quote, status) | Works | Works |
| CLOB market data (orderbook, prices, midpoints, spreads, history) | Works | Works |
| **CLOB trading** (buy, sell, cancel, orders, trades, heartbeat) | **HIDDEN + BLOCKED** | **Required** |

**Key generation**: `echoclaw polymarket setup --yes` — signs EIP-712 message with wallet, derives API credentials automatically. One-time, keys don't expire.

**ENV setup** — add to `~/.config/echoclaw/.env`:
```
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_PASSPHRASE=...
```

Launcher passes `.env` to container → `process.env` → runtime checks `requiresEnv: "POLYMARKET_API_KEY"` on 11 trading tools. Without keys, 58 public tools work normally.

## Structure

```
polymarket/
├── manifest.ts              # Aggregates all module manifests (69 tools)
├── handlers.ts              # Aggregator: imports bridge + clob + data + gamma handlers
├── handlers-bridge.ts       # Bridge handlers (5)
├── handlers-clob.ts         # CLOB handlers (25)
├── handlers-data.ts         # Data API handlers (14)
├── handlers-gamma.ts        # Gamma API handlers (25)
├── README.md
└── manifests/
    ├── bridge.ts            # polymarket.bridge.assets/deposit/withdraw/quote/status (5)
    ├── clob.ts              # polymarket.clob.orderbook/price/midpoint/spread/... + buy/sell/cancel/... (25)
    ├── data.ts              # polymarket.data.positions/activity/leaderboard/trades/... (14)
    └── gamma.ts             # polymarket.gamma.events/markets/search/tags/comments/... (25)
```

## Tool breakdown

### Bridge (5) — `bridge.polymarket.com` — no auth

| Tool | Method | Description |
|------|--------|-------------|
| `polymarket.bridge.assets` | GET /supported-assets | Supported chains + tokens |
| `polymarket.bridge.deposit` | POST /deposit | Create deposit address (EVM/SVM/BTC) |
| `polymarket.bridge.withdraw` | POST /withdraw | Create withdrawal |
| `polymarket.bridge.quote` | POST /quote | Bridge quote: fees, ETA, output |
| `polymarket.bridge.status` | GET /status/{addr} | Track bridge tx status |

### CLOB Market Data (14) — `clob.polymarket.com` — no auth

| Tool | Description |
|------|-------------|
| `polymarket.clob.orderbook` | Full orderbook (bids, asks, tick size) |
| `polymarket.clob.orderbooks` | Batch orderbooks |
| `polymarket.clob.price` | Best price for BUY/SELL |
| `polymarket.clob.prices` | Batch prices |
| `polymarket.clob.midpoint` | Midpoint price |
| `polymarket.clob.midpoints` | Batch midpoints |
| `polymarket.clob.spread` | Bid-ask spread |
| `polymarket.clob.spreads` | Batch spreads |
| `polymarket.clob.lastTrade` | Last trade price + side |
| `polymarket.clob.lastTrades` | Batch last trades |
| `polymarket.clob.priceHistory` | OHLC time-series |
| `polymarket.clob.tickSize` | Min tick size |
| `polymarket.clob.feeRate` | Fee rate (bps) |
| `polymarket.clob.serverTime` | Server timestamp |

### CLOB Trading (11) — `clob.polymarket.com` — requiresEnv: POLYMARKET_API_KEY

| Tool | Description |
|------|-------------|
| `polymarket.clob.buy` | Buy YES/NO shares (resolve market → fee → build → EIP-712 sign → submit) |
| `polymarket.clob.sell` | Sell YES/NO shares |
| `polymarket.clob.cancel` | Cancel single order |
| `polymarket.clob.cancelOrders` | Cancel batch by IDs (max 3000) |
| `polymarket.clob.cancelAll` | Cancel all orders |
| `polymarket.clob.cancelMarket` | Cancel all in market |
| `polymarket.clob.orders` | List open orders (paginated) |
| `polymarket.clob.order` | Single order detail |
| `polymarket.clob.trades` | List CLOB trades (paginated) |
| `polymarket.clob.heartbeat` | Keep-alive (orders auto-cancel if stopped) |
| `polymarket.clob.orderScoring` | Check reward scoring status |

### Data (14) — `data-api.polymarket.com` — no auth

| Tool | Description |
|------|-------------|
| `polymarket.data.positions` | Open positions with PnL |
| `polymarket.data.closedPositions` | Closed positions with realized PnL |
| `polymarket.data.activity` | Activity: TRADE, SPLIT, MERGE, REDEEM, REWARD |
| `polymarket.data.trades` | Trades with tx hashes |
| `polymarket.data.value` | Portfolio value (USD) |
| `polymarket.data.traded` | Markets traded count |
| `polymarket.data.holders` | Top holders per outcome |
| `polymarket.data.openInterest` | OI per market |
| `polymarket.data.liveVolume` | Live event volume |
| `polymarket.data.marketPositions` | All positions in market |
| `polymarket.data.leaderboard` | Rankings (PnL/volume by category) |
| `polymarket.data.builderLeaderboard` | Builder rankings |
| `polymarket.data.builderVolume` | Builder volume time-series |
| `polymarket.data.accountingSnapshot` | CSV download URL |

### Gamma (25) — `gamma-api.polymarket.com` — no auth

| Tool | Description |
|------|-------------|
| `polymarket.gamma.events` | Browse events (filter: tag, active, featured, min liquidity/volume) |
| `polymarket.gamma.event` | Single event by ID |
| `polymarket.gamma.eventBySlug` | Single event by slug |
| `polymarket.gamma.eventTags` | Tags for event |
| `polymarket.gamma.markets` | Browse markets |
| `polymarket.gamma.market` | Single market (conditionId → clobTokenIds, negRisk, prices) |
| `polymarket.gamma.marketBySlug` | Single market by slug |
| `polymarket.gamma.marketTags` | Tags for market |
| `polymarket.gamma.search` | Cross-entity search (events + tags + profiles) |
| `polymarket.gamma.tags` | List all tags |
| `polymarket.gamma.tag` | Single tag by ID |
| `polymarket.gamma.tagBySlug` | Single tag by slug |
| `polymarket.gamma.relatedTags` | Related tag IDs by ID |
| `polymarket.gamma.relatedTagsBySlug` | Related tag IDs by slug |
| `polymarket.gamma.tagsRelatedToTag` | Full related tags by ID |
| `polymarket.gamma.tagsRelatedToTagBySlug` | Full related tags by slug |
| `polymarket.gamma.series` | Event series |
| `polymarket.gamma.seriesById` | Single series |
| `polymarket.gamma.comments` | Browse comments |
| `polymarket.gamma.comment` | Single comment |
| `polymarket.gamma.commentsByUser` | Comments by user |
| `polymarket.gamma.profile` | Public profile |
| `polymarket.gamma.sportsMetadata` | Sports categories |
| `polymarket.gamma.sportsMarketTypes` | Sport market types |
| `polymarket.gamma.teams` | Teams with leagues |

## Source imports

| Handler file | Imports from |
|-------------|-------------|
| `handlers-bridge.ts` | `@tools/polymarket/bridge/client.ts` |
| `handlers-clob.ts` | `@tools/polymarket/clob/client.ts`, `clob/signing.ts`, `auth.ts`, `gamma/client.ts` |
| `handlers-data.ts` | `@tools/polymarket/data/client.ts` |
| `handlers-gamma.ts` | `@tools/polymarket/gamma/client.ts` |
| CLOB trading | `@tools/wallet/multi-auth.ts` (requireEvmWallet), `@commands/polymarket/helpers.ts` (parseClobTokenIds) |

## What is NOT a protocol tool

- **WebSocket streams** (`ws-market.ts`, `ws-user.ts`) — long-lived connections, don't fit discover/execute
- **Relayer API** (`relayer/client.ts`) — internal gasless tx submission infrastructure
- **EVM utils** (`evm-utils.ts`) — USDC.e approval, Polygon client setup — used internally by handlers
- **API key derivation** (`setup.ts` CLI command) — one-time setup, not a runtime tool

## Value formats (from Polymarket.md)

- **Prices**: 0-1 float (probability). `0.65` = 65% chance
- **Amounts (CLOB)**: string, 6 decimal USDC.e base units. `"100000000"` = 100 USDC
- **Amounts (Data)**: number, human-readable. `100.5` = 100.5 shares
- **PnL**: number, USD. `12.50` = $12.50
- **Volume (Gamma)**: number, USD. `1234567` = $1.23M
- **Timestamps**: mixed — ISO 8601 (Gamma), unix seconds string (CLOB), unix integer (Data)
- **outcomePrices/outcomes/clobTokenIds**: JSON strings — parse with `JSON.parse()`

## Trade capture

Buy/sell handlers return `_tradeCapture` in `data` field:
- `type: "prediction"`
- `chain: "polygon"`
- `status: "executed" | "open"`
- `meta: { dex: "polymarket", conditionId, outcome, price }`

## Contracts (Polygon)

| Contract | Address |
|----------|---------|
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| Conditional Tokens | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| USDC.e (collateral) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (6 decimals) |
