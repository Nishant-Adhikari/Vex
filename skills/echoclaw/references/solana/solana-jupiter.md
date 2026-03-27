# Solana / Jupiter Reference

This module is the authoritative guide for `echoclaw solana *`. All Solana operations use Jupiter as the backend — swaps, perpetual futures, token discovery, pricing, lending, predictions, DCA, limit orders, token creation, portfolio, and trade history.

## Scope

- token swap (Ultra API — aggregates Raydium, Orca, Meteora, all Solana DEXes)
- perpetual futures (Jupiter Perps — leveraged long/short SOL/BTC/ETH with TP/SL)
- token browse (trending, top-traded, recent)
- price lookup
- SOL and SPL token transfers
- SOL staking (delegate, withdraw, claim MEV)
- DCA (dollar-cost averaging via Jupiter Recurring API)
- limit orders (Jupiter Trigger V1 API)
- lending (Jupiter Lend Earn — deposit, withdraw, rates, earnings)
- prediction markets (Jupiter Prediction — buy/sell YES/NO, close-all, history)
- portfolio / holdings (Ultra holdings API)
- token security (Ultra Shield API)
- token creation (Jupiter Studio — requires API key)
- send via invite code (Jupiter Send)
- spot trade history (Jupiter Datapi)
- SPL token burn and empty account closure

## Prerequisites

- Solana wallet configured: `echoclaw wallet create --chain solana` or `echoclaw wallet import --chain solana`
- `ECHO_KEYSTORE_PASSWORD` env var set
- Optional: `echoclaw config set-jupiter-key <key>` for higher rate limits and Studio access
- Optional: `echoclaw config set-solana-rpc <url>` for private RPC (default: public mainnet)

## Core commands

### Swap

```bash
echoclaw solana swap quote <from> <to> --amount <n> [--slippage-bps <bps>] --json
echoclaw solana swap execute <from> <to> --amount <n> [--slippage-bps <bps>] --yes --json
```

Tokens can be symbols (`SOL`, `USDC`, `BONK`) or mint addresses. Jupiter Ultra routes through all Solana DEXes automatically.

### Perpetual Futures (Perps)

```bash
echoclaw solana perps markets --json
echoclaw solana perps positions [--address <addr>] --json
echoclaw solana perps history [--asset SOL] [--side long] [--limit 20] --json
echoclaw solana perps open --asset SOL --side long --amount 10 --input USDC --leverage 2 [--tp 100] [--sl 70] --yes --json
echoclaw solana perps open --asset BTC --side long --amount 10 --leverage 2 --limit 65000 --yes --json
echoclaw solana perps close --position <pubkey> [--size 5] [--receive USDC] --yes --json
echoclaw solana perps close --position all --yes --json
echoclaw solana perps set --position <pubkey> --tp 100 --sl 70 --yes --json
echoclaw solana perps set --order <pubkey> --limit 64000 --yes --json
echoclaw solana perps set --tpsl <pubkey> --tp 105 --yes --json
echoclaw solana perps cancel --order <pubkey> --yes --json
echoclaw solana perps cancel --tpsl <pubkey> --yes --json
```

Three markets: **SOL**, **BTC**, **ETH**. Collateral: SOL, BTC, ETH, USDC. Min $10. Two sizing modes: `--leverage` (size = amount × leverage) or `--size` (explicit USD size). `--side` accepts `long`/`short`/`buy`/`sell`. `--limit` for limit orders (cannot combine with `--tp`/`--sl`). `set --tpsl` updates an existing TP/SL trigger price in-place (vs `set --position` which creates new TP/SL). Uses `perps-api.jup.ag/v2`.

### Browse & Price

```bash
echoclaw solana browse [category] [--interval 1h|6h|24h] [--limit <n>] --json
echoclaw solana price <token...> --json
```

Categories: `trending`, `top-traded`, `top-organic`, `recent`, `lst`, `verified`.

### Transfer (2-step: prepare → confirm)

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

Prepare creates a time-limited intent (10min TTL). Confirm requires `--yes` + decrypts keystore. Same security model as 0G transfers.

### Staking

```bash
echoclaw solana stake list --json
echoclaw solana stake delegate --amount <SOL> [--validator <vote-address>] --yes --json
echoclaw solana stake withdraw <stake-account> [--amount <SOL>] --yes --json
echoclaw solana stake claim-mev [stake-account] --yes --json
```

Default validator: Solana Compass. MEV claim withdraws only excess tips, not principal.

### DCA (Dollar-Cost Averaging)

```bash
echoclaw solana dca create <amount-per-cycle> <from> <to> --every <interval> --count <n> --yes --json
echoclaw solana dca list --json
echoclaw solana dca cancel <orderKey> --yes --json
```

Intervals: `minute`, `hour`, `day`, `week`, `month`. Uses Jupiter Recurring API.

### Limit Orders

```bash
echoclaw solana limit create <amount> <from> <to> --at <target-price-usd> --yes --json
echoclaw solana limit list --json
echoclaw solana limit cancel <orderKey> --yes --json
```

`--at` is the target USD price for the output token. Uses Jupiter Trigger V1 API.

### Lending

```bash
echoclaw solana lend rates [token] --json
echoclaw solana lend positions --json
echoclaw solana lend deposit <token> --amount <n> --yes --json
echoclaw solana lend withdraw <token> --amount <n> --yes --json
```

Jupiter Lend Earn. Rates include `supplyRate` and `totalRate` (supply + rewards). `positions` shows accrued earnings per position via Jupiter earnings API.

### Portfolio & Holdings

```bash
echoclaw solana portfolio --json
echoclaw solana holdings --json
```

`portfolio` uses Ultra holdings API (token balances with account details). For cross-chain portfolio use `echoclaw wallet balances --wallet solana` (Khalani).

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

Categories: `crypto`, `sports`, `politics`, `culture`, `economics`, `tech` etc. Uses managed execution via `/orders/execute` for better transaction landing.

### Token Security

```bash
echoclaw solana shield <mint...> --json
```

Returns security warnings per token: `NOT_VERIFIED`, `LOW_LIQUIDITY`, `HAS_MINT_AUTHORITY`, `HAS_FREEZE_AUTHORITY`, etc. Severity: `info`, `warning`, `critical`.

### Token Creation (Studio)

```bash
echoclaw solana studio create --name <n> --symbol <s> --image <path> --initial-mcap <usd> --migration-mcap <usd> [--fee-bps <n>] [--lock-lp] --yes --json
echoclaw solana studio fees <mint> --json
echoclaw solana studio claim-fees <pool> --yes --json
```

Requires Jupiter API key. Creates tokens with Dynamic Bonding Curves on Jupiter.

### Send via Invite

```bash
echoclaw solana send-invite --amount <n> [--token <mint>] --yes --json
echoclaw solana invites --json
echoclaw solana clawback <invite-code> --yes --json
```

Recipients claim via Jupiter Mobile. Unclaimed invites can be clawed back.

### Trade History

```bash
echoclaw solana history [--address <addr>] [--token SOL] [--after 2026-01-01] [--before 2026-03-01] [--limit 10] [--offset <id>] --json
```

Shows swap trade history with input/output tokens and USD values. Groups double-bookkeeping entries by transaction. Uses Jupiter Datapi (`_datapi/v1/txs/users`). Pagination via `--offset` with `next` value from previous response.

### Account Management

```bash
echoclaw solana burn <token> [amount] --yes --json
echoclaw solana close-accounts --yes --json
```

`close-accounts` closes all empty SPL token accounts and reclaims rent (~0.002 SOL each).

## Execution model

- **Percentage conventions:** `priceImpactPct` is ALREADY a percentage (`0.01` = 0.01%, do NOT multiply by 100). `slippageBps` is in basis points (divide by 100 for %). Jupiter Lend `supplyRate`/`totalRate` are fractional (multiply by 100 for %).
- all read commands (`browse`, `price`, `list`, `rates`, `positions`, `portfolio`, `holdings`, `shield`, `invites`, `markets`, `history`) are safe and idempotent
- all write commands (`execute`, `send`, `deposit`, `withdraw`, `create`, `cancel`, `buy`, `sell`, `claim`, `burn`, `close-accounts`, `delegate`, `clawback`, `open`, `close`, `close-all`, `set`) require `--yes`
- without `--yes`, write commands show a preview and exit with `CONFIRMATION_REQUIRED`
- `--json` routes all UI to stderr, structured output to stdout
- cluster warning appears on write commands when not on `mainnet-beta`

## Agent-safe flow

1. `echoclaw wallet ensure --json` — verify Solana wallet exists
2. `echoclaw config show --json` — check Solana cluster and Jupiter key
3. Read command (browse, price, rates, etc.) — gather information
4. Write command with `--yes --json` — execute action
5. Parse JSON response for `signature` and `explorerUrl`

## Success examples

Swap quote:

```json
{
  "ok": true,
  "data": {
    "inputToken": "SOL",
    "outputToken": "USDC",
    "inputAmount": "1",
    "outputAmount": "150.25",
    "priceImpactPct": "0.01",
    "route": ["Raydium"],
    "provider": "jupiter-ultra (iris)"
  }
}
```

Swap execute:

```json
{
  "ok": true,
  "data": {
    "signature": "4xK9...abc",
    "explorerUrl": "https://explorer.solana.com/tx/4xK9...abc",
    "inputAmount": "1",
    "outputAmount": "150.25"
  }
}
```

Transfer:

```json
{
  "ok": true,
  "data": {
    "signature": "5aB...xyz",
    "explorerUrl": "https://explorer.solana.com/tx/5aB...xyz",
    "from": "7nY...abc",
    "to": "GkX...def",
    "amount": 2,
    "token": "SOL"
  }
}
```

## Khalani overlap — what NOT to duplicate

These are already handled by Khalani and should not be reimplemented via Jupiter:

- **SOL balance**: `echoclaw wallet balances --wallet solana`
- **SPL token balances with USD**: `echoclaw wallet balances --wallet solana`
- **Token search/info**: `echoclaw khalani tokens search <query>`
- **Cross-chain bridge**: `echoclaw khalani bridge ...`

Use Solana commands for Solana-native operations (swap, stake, lend, predict). Use Khalani for cross-chain operations and balance aggregation.

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
- `SOLANA_STAKE_FAILED`
- `SOLANA_ORDER_FAILED`
- `SOLANA_PORTFOLIO_FAILED`
- `SOLANA_LEND_DEPOSIT_FAILED`
- `SOLANA_LEND_WITHDRAW_FAILED`
- `SOLANA_LEND_RATES_FAILED`
- `SOLANA_SEND_INVITE_FAILED`
- `SOLANA_SEND_CLAWBACK_FAILED`
- `SOLANA_PREDICT_ORDER_FAILED`
- `SOLANA_PREDICT_CLAIM_FAILED`
- `SOLANA_STUDIO_CREATE_FAILED` (requires Jupiter API key)
- `SOLANA_STUDIO_CLAIM_FAILED` (requires Jupiter API key)
- `SOLANA_LP_POOL_NOT_FOUND`
- `CONFIRMATION_REQUIRED` (add `--yes` to execute)
