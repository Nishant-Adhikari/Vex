# Solana/Jupiter Protocol — Echo Agent

52 tools across 12 modules. All handlers import directly from `@tools/chains/solana/` TS clients — no CLI spawning.

## API Key

Jupiter API key is optional for most features but **required for Studio** (token creation, fee claim).

| Feature | Without key (`lite-api.jup.ag`) | With key (`api.jup.ag`) |
|---------|-------------------------------|------------------------|
| Swap, Tokens, Holdings, Shield | Works (lower rate limits) | Works (60 req/min) |
| DCA, Limit orders, Lend, Predictions | Works | Works |
| Send, Spot history, Perps | Works | Works |
| **Studio** (create token, claim fees) | **BLOCKED — 404** | **Required** |

**Key resolution chain** (in `jupiter-client.ts:resolveJupiterApiKey()`):
1. `process.env.JUPITER_API_KEY` — set by echo-agent via `.env` (launcher passes to container)
2. `loadConfig().solana.jupiterApiKey` — CLI config store fallback
3. Empty string → lite-api.jup.ag (no key)

ENV setup: add `JUPITER_API_KEY=...` to `.env` (free from [portal.jup.ag](https://portal.jup.ag))
CLI setup: `echoclaw config set-jupiter-key <key>`

## Structure

```
solana-jupiter/
├── manifest.ts              # Aggregates all module manifests
├── handlers.ts              # All handler functions (imports from @tools/chains/solana/)
├── README.md
└── manifests/
    ├── core.ts              # solana.holdings, .prices, .tokens.search/trending/shield (5)
    ├── swap.ts              # solana.swap.quote, .swap.execute (2)
    ├── perps.ts             # .perps.markets/positions/history/open/close/closeAll/tpsl/cancelLimitOrder/updateLimitOrder/cancelTpsl/updateTpsl (11)
    ├── predict.ts           # .predict.events/search/market/event/position/positions/history/buy/sell/claim/closeAll (11)
    ├── orders.ts            # .dca.list/create/cancel (3) + .limit.list/create/cancel (3) = (6)
    ├── lend.ts              # .lend.rates/positions/deposit/withdraw (4)
    ├── stake.ts             # .stake.accounts/delegate/withdraw/claimMev (4)
    ├── send.ts              # .send.pending/invite/clawback (3)
    ├── studio.ts            # .studio.fees/create/claimFees (3)
    ├── account.ts           # .account.burn/closeEmpty (2)
    └── history.ts           # .history.spot (1)
```

## Source imports

All handlers import from existing TS clients — no duplication:

| Handler module | Imports from |
|---------------|-------------|
| Core | `@tools/chains/solana/jupiter-client.ts` |
| Swap | `@tools/chains/solana/swap-service.ts` |
| Perps | `@tools/chains/solana/perps-service.ts`, `perps-client.ts` |
| Predict | `@tools/chains/solana/prediction-service.ts` |
| DCA + Limit | `@tools/chains/solana/order-service.ts` |
| Lend | `@tools/chains/solana/lend-service.ts` |
| Stake | `@tools/chains/solana/stake-service.ts` |
| Send | `@tools/chains/solana/send-service.ts` |
| Studio | `@tools/chains/solana/studio-service.ts` |
| Account | `@tools/chains/solana/account-service.ts` |
| Wallet | `@tools/wallet/multi-auth.ts` (requireSolanaWallet) |

## What is NOT a protocol tool (handled elsewhere)

- **Native SOL/SPL transfers** (`sendSol`, `sendSplToken`) → internal wallet tool (`wallet_send_*`)
- **Token resolution** (`resolveToken`, `resolveTokens`) → internal helper, used by handlers
- **Connection, tx signing, validation** → infrastructure, imported by handlers internally

## Value formats (from SOLANA.md)

- **Swap amounts**: atomic strings — divide by `10^decimals`
- **Perps**: already USD strings — parse to number directly
- **Predictions**: micro-USD (÷ 1,000,000) for position values/prices
- **DCA/Limit**: atomic strings — need token decimals
- **Lend rates**: fractional (× 100 for %)
- **Staking**: already converted to SOL
- **Price API**: USD strings

## Trade capture

Mutating handlers return `_tradeCapture` in `data` field — runtime auto-stores without `trade_log` tool. Types: swap, perps, prediction, lend, stake.
