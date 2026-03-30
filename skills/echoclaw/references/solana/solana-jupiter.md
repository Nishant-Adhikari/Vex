# Solana / Jupiter Reference

This module is the authoritative guide for `echoclaw solana *`. All Jupiter operations require `JUPITER_API_KEY`.

## Scope

- token swap (Jupiter Swap API V2 — aggregates Raydium, Orca, Meteora, all Solana DEXes)
- token browse (trending, top-traded, top-organic, recent, LST, verified)
- price lookup (Jupiter Price API V3)
- lending (Jupiter Lend Earn — deposit, withdraw, rates, earnings)
- prediction markets (Jupiter Prediction — buy/sell YES/NO, close-all, history)
- SOL and SPL token transfers (non-Jupiter utility, uses Solana native)
- SPL token burn and empty account closure (non-Jupiter utility)

### Deferred (no new shelf backing yet)

Perpetual futures, DCA, limit orders, staking, send-invite, Studio, portfolio/holdings, token security (shield), spot trade history. These will return when their Jupiter shelf implementations are complete.

## Prerequisites

- Solana wallet configured: `echoclaw wallet create --chain solana` or `echoclaw wallet import --chain solana`
- `ECHO_KEYSTORE_PASSWORD` env var set
- **Required**: `echoclaw config set-jupiter-key <key>` — all Jupiter features need this key (free from [portal.jup.ag](https://portal.jup.ag))
- Optional: `echoclaw config set-solana-rpc <url>` for private RPC (default: public mainnet)

## Core commands

### Swap

```bash
echoclaw solana swap quote <from> <to> --amount <n> [--slippage-bps <bps>] --json
echoclaw solana swap execute <from> <to> --amount <n> [--slippage-bps <bps>] --yes --json
```

Tokens can be symbols (`SOL`, `USDC`, `BONK`) or mint addresses. Jupiter Swap API V2 routes through all Solana DEXes automatically. `--json` output includes full wire-first metadata (raw amounts, route plan, request identifiers, order/execute payloads).

### Browse & Price

```bash
echoclaw solana browse [category] [--interval 1h|6h|24h] [--limit <n>] --json
echoclaw solana price <token...> --json
```

Categories: `trending`, `top-traded`, `top-organic`, `recent`, `lst`, `verified`.

### Transfer (2-step: prepare -> confirm)

```bash
# SOL: prepare intent (read-only, no key access)
echoclaw solana send prepare --to <address> --amount <SOL> [--note <text>] --json
# SOL: confirm and broadcast (requires --yes + password)
echoclaw solana send confirm <intentId> --yes --json

# SPL token: prepare intent
echoclaw solana send-token prepare --to <address> --token <symbol_or_mint> --amount <n> --json
# SPL token: confirm and broadcast
echoclaw solana send-token confirm <intentId> --yes --json
```

### Lending

```bash
echoclaw solana lend rates [token] --json
echoclaw solana lend positions --json
echoclaw solana lend deposit <token> --amount <n> --yes --json
echoclaw solana lend withdraw <token> --amount <n> --yes --json
```

Jupiter Lend Earn. Rates include `supplyRate` and `totalRate` (supply + rewards). `positions` shows accrued earnings per position.

### Prediction Markets

```bash
echoclaw solana predict list [category] [--filter trending|live|new] --json
echoclaw solana predict search <query> --json
echoclaw solana predict event <eventId> --json
echoclaw solana predict market <marketId> --json
echoclaw solana predict position <positionPubkey> --json
echoclaw solana predict buy <marketId> --side yes|no --amount <USDC> --yes --json
echoclaw solana predict sell <positionPubkey> --yes --json
echoclaw solana predict claim <positionPubkey> --yes --json
echoclaw solana predict close-all --yes --json
echoclaw solana predict positions --json
echoclaw solana predict history [--limit 10] [--offset 0] --json
```

Categories: `crypto`, `sports`, `politics`, `culture`, `economics`, `tech`.

### Account Management

```bash
echoclaw solana burn <token> [amount] --yes --json
echoclaw solana close-accounts --yes --json
```

## Execution model

- **Percentage conventions:** `priceImpactPct` is ALREADY a percentage (`0.01` = 0.01%, do NOT multiply by 100). `slippageBps` is in basis points (divide by 100 for %). Jupiter Lend `supplyRate`/`totalRate` are fractional (multiply by 100 for %).
- all read commands (`browse`, `price`, `list`, `rates`, `positions`) are safe and idempotent
- all write commands (`execute`, `deposit`, `withdraw`, `buy`, `sell`, `claim`, `burn`, `close-accounts`) require `--yes`
- without `--yes`, write commands show a preview and exit with `CONFIRMATION_REQUIRED`
- `--json` routes all UI to stderr, structured output to stdout — includes full wire-first metadata for machine consumers

## Error codes

- `SOLANA_INVALID_ADDRESS`
- `SOLANA_INSUFFICIENT_BALANCE`
- `SOLANA_TRANSFER_FAILED`
- `SOLANA_TX_FAILED`
- `SOLANA_TX_TIMEOUT`
- `SOLANA_TOKEN_NOT_FOUND`
- `SOLANA_RPC_ERROR`
- `SOLANA_QUOTE_FAILED`
- `SOLANA_SWAP_FAILED`
- `SOLANA_LEND_DEPOSIT_FAILED`
- `SOLANA_LEND_WITHDRAW_FAILED`
- `SOLANA_LEND_RATES_FAILED`
- `SOLANA_PREDICT_ORDER_FAILED`
- `SOLANA_PREDICT_CLAIM_FAILED`
- `CONFIRMATION_REQUIRED` (add `--yes` to execute)
