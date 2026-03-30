# Solana/Jupiter Protocol — Echo Agent

20 tools across 4 modules. All handlers import from `src/tools/solana-ecosystem/jupiter/` shelves.

## API Key

Jupiter API key is **required** for all Solana protocol tools.

Without `JUPITER_API_KEY`, the entire `solana` namespace is hidden from discovery and blocked in execution.

**echo-agent discovery/execute**: gates strictly on `process.env.JUPITER_API_KEY`. Config-store key does NOT make tools visible to the agent — only env var does.

**CLI commands**: resolve key via `process.env.JUPITER_API_KEY` first, then `loadConfig().solana.jupiterApiKey` as fallback.

ENV setup: add `JUPITER_API_KEY=...` to `.env` (free from [portal.jup.ag](https://portal.jup.ag))
CLI setup: `echoclaw config set-jupiter-key <key>`

## Structure

```
solana-jupiter/
├── manifest.ts              # Aggregates all module manifests (20 tools)
├── handlers.ts              # All handler functions (imports from solana-ecosystem/jupiter/)
├── README.md
└── manifests/
    ├── core.ts              # solana.prices, .tokens.search, .tokens.trending (3)
    ├── swap.ts              # solana.swap.quote, .swap.execute (2)
    ├── predict.ts           # .predict.events/search/market/event/position/positions/history/buy/sell/claim/closeAll (11)
    └── lend.ts              # .lend.rates/positions/deposit/withdraw (4)
```

## Source imports

All handlers import from new Jupiter shelves — no legacy `src/tools/chains/solana/` imports:

| Handler module | Imports from |
|---------------|-------------|
| Core (prices) | `solana-ecosystem/jupiter/jupiter-prices/service.ts` |
| Core (tokens) | `solana-ecosystem/jupiter/jupiter-tokens/service.ts` |
| Swap | `solana-ecosystem/jupiter/jupiter-swaps/service.ts` |
| Predict | `solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.ts` |
| Lend | `solana-ecosystem/jupiter/jupiter-lend/earn-api/service.ts` |
| Swap classify | `solana-ecosystem/shared/swap-classify.ts` |
| Wallet | `@tools/wallet/multi-auth.ts` (requireSolanaWallet) |

## Deferred features (no new shelf backing yet)

Perps, DCA, limit orders, staking, send/invite, Studio, token holdings, token shield, account management, spot trade history. These will return when their Jupiter shelf implementations are complete.

## Trade capture

Mutating handlers return `_tradeCapture` in `data` field — runtime auto-stores without `trade_log` tool. Types: swap, prediction, lend.
