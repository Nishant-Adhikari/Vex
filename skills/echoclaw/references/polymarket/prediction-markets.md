# Polymarket Prediction Markets Reference

This is the primary reference for `echoclaw polymarket *` — EVM prediction markets on Polygon.

## Scope

Polymarket is the largest prediction market on Polygon (chain ID 137). Users buy/sell YES/NO outcome shares on events across politics, sports, crypto, culture, economics, and tech.

## Prerequisites

- EVM wallet: `echoclaw wallet create` or `echoclaw wallet import`
- For trading: `echoclaw polymarket setup --yes` (auto-generates API key, one-click)
- For browsing: no setup needed (public APIs)

## Core commands

```bash
# Setup (one-click API key generation)
echoclaw polymarket setup --yes --json

# Browse events
echoclaw polymarket events [--featured] [--active] [--category <cat>] [--limit <n>] --json
echoclaw polymarket event <id-or-slug> --json
echoclaw polymarket search <query> --json

# Market details
echoclaw polymarket market <id-or-slug> --json

# Trading (requires setup)
echoclaw polymarket buy <condition-id> --outcome yes|no --amount <usdc> [--price <0-1>] --dry-run --json
echoclaw polymarket buy <condition-id> --outcome yes|no --amount <usdc> --yes --json
echoclaw polymarket sell <condition-id> --outcome yes|no --amount <shares> --yes --json

# Portfolio
echoclaw polymarket positions --json
echoclaw polymarket orders --json
echoclaw polymarket cancel <orderId> --yes --json
echoclaw polymarket cancel-all --yes --json
```

## Execution model

- **Read-only commands** (events, event, search, market, orderbook, positions, leaderboard): no auth, safe, idempotent
- **Write commands** (buy, sell, cancel, setup): require `--yes`, show `CONFIRMATION_REQUIRED` without it
- `--dry-run` shows preview without executing
- `--json` outputs structured JSON to stdout

## Auto-setup guardrail

If any trading command returns `POLYMARKET_NOT_CONFIGURED`, the agent MUST automatically run:
```bash
echoclaw polymarket setup --yes --json
```
This signs with the EVM wallet, derives CLOB API credentials, and saves them to `~/.config/echoclaw/.env`. Zero user interaction needed. Then retry the original command.

## Agent-safe flow

### Browse and buy:
1. `echoclaw wallet ensure --json`
2. `echoclaw polymarket setup --yes --json` (auto-triggered on `POLYMARKET_NOT_CONFIGURED`)
3. `echoclaw polymarket events --featured --limit 5 --json`
4. `echoclaw polymarket market <condition-id> --json`
5. `echoclaw polymarket buy <condition-id> --outcome yes --amount 10 --dry-run --json`
6. `echoclaw polymarket buy <condition-id> --outcome yes --amount 10 --yes --json`
7. `echoclaw polymarket positions --json`

### Track another user:
1. `echoclaw polymarket profile <address> --json`
2. `echoclaw polymarket positions --user <address> --json`
3. `echoclaw polymarket activity --user <address> --json`

## Token resolution

Markets have a `conditionId` and two `clobTokenIds` — one for YES, one for NO. The CLI resolves these automatically from the condition ID + `--outcome yes|no`.

## Overlap

- **Solana prediction markets** → use `echoclaw solana predict` (Jupiter)
- **EVM prediction markets** → use `echoclaw polymarket` (this module)
- **EVM swaps** → use `echoclaw kyberswap`
- **Cross-chain bridge** → use `echoclaw khalani bridge`

## Error codes

- `POLYMARKET_API_ERROR` — generic API error
- `POLYMARKET_TIMEOUT` — request timeout
- `POLYMARKET_RATE_LIMITED` — too many requests
- `POLYMARKET_AUTH_FAILED` — invalid API key
- `POLYMARKET_ORDER_FAILED` — order rejected
- `POLYMARKET_MARKET_NOT_FOUND` — market not found
- `POLYMARKET_NOT_CONFIGURED` — run `polymarket setup --yes`
- `CONFIRMATION_REQUIRED` — add `--yes`
