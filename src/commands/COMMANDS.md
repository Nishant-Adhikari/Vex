# Commands — CLI Command Tree

> All Commander.js command definitions for the `echoclaw` CLI. Each subfolder is a command group with its own `index.ts` factory. Root-level files are standalone commands or cross-cutting utilities.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove commands, update the command tree, fix stale references.

---

## Directory Structure

```
src/commands/
  config.ts               — `echoclaw config` — init, show, reset, set
  send.ts                 — `echoclaw send` — prepare/confirm native 0G transfers (intent-based)
  setup.ts                — `echoclaw setup` — OpenClaw linking, password, legacy cleanup, webhooks
  skill.ts                — `echoclaw skill install` — install EchoClaw skill into AI runtime
  slop-stream.ts          — `echoclaw slop-stream <token>` — real-time WS token updates

  0g-compute/             — `echoclaw 0g-compute` (alias: 0g)
  0g-storage/             — `echoclaw 0g-storage` (alias: storage)
  chainscan/              — `echoclaw chainscan`
  claude/                 — `echoclaw claude` (nested under echo)
  dexscreener/            — `echoclaw dexscreener`
  echo/                   — `echoclaw echo` — main launcher hub
  echobook/               — `echoclaw echobook`
  jaine/                  — `echoclaw jaine`
  khalani/                — `echoclaw khalani`
  kyberswap/              — `echoclaw kyberswap`
  marketmaker/            — `echoclaw marketmaker` (alias: mm)
  onboard/                — `echoclaw onboard` — interactive setup wizard
  polymarket/             — `echoclaw polymarket`
  slop/                   — `echoclaw slop`
  slop-app/               — `echoclaw slop-app`
  solana/                 — `echoclaw solana`
  update/                 — `echoclaw update`
  wallet/                 — `echoclaw wallet`
```

---

## Command Tree

Registration happens in `src/cli-runtime.ts`. Every command group exports a `create*Command()` factory that returns a `Command` instance.

### Core / Infrastructure

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `echo` | connect, fund, verify, status, doctor, support-report, wallet, claude, launcher, agent | Main launcher hub — human-first setup, diagnostics, agent control |
| `config` | init, show, reset, set | Manage `~/.echoclaw/config.json` |
| `setup` | openclaw, password, webhooks, legacy-cleanup | OpenClaw linking, keystore password, notification hooks |
| `onboard` | (interactive wizard) | Step-by-step setup: config → openclaw → password → webhooks → wallet → compute → monitor → gateway |
| `wallet` | create, address, balance, balances, import, ensure, export-key, backup, restore | EVM + Solana keystore management |
| `send` | prepare, confirm | Intent-based native 0G transfers (prepare → confirm pattern) |
| `skill` | install, uninstall | Install/remove EchoClaw skill in AI runtime |
| `update` | check, enable, disable, status | Auto-update preferences and daemon |

### 0G Network

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `0g-compute` | setup, providers, ledger, provider, api-key, monitor | 0G Compute Network: inference, funding, provider management |
| `0g-storage` | setup, wizard, file, drive, note, backup | 0G Storage: virtual drive, notes, agent backup |
| `chainscan` | balance, balance-multi, token-balance, token-supply, txs, transfers, tx, contract, decode, stats | On-chain data from 0G ChainScan explorer |

### 0G DeFi

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `jaine` | tokens, pools, w0g, allowance, swap, lp, subgraph | Jaine DEX on 0G (swap, LP, pools) |
| `slop` | token, tokens, trade, price, curve, fees, reward | Slop.money bonding curve operations |
| `slop-app` | profile, image, chat, agents | Slop.money social APIs (profile, image gen, chat) |
| `slop-stream` | (single command) | Real-time token updates via WebSocket |
| `marketmaker` | order, start, stop, status | Trading bot daemon + order management |
| `echobook` | auth, profile, submolts, posts, comments, vote, follow, repost, follows, points, trade-proof, notifications, verify-owner | Social trading platform |

### Multi-chain DeFi

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `khalani` | chains, tokens, quote, bridge, orders, order | Cross-chain bridge (40+ chains) |
| `kyberswap` | chains, tokens, swap, limit-order, zap | Multi-chain EVM swaps (18 chains, 400+ DEXs) |
| `polymarket` | setup, events, event, search, market, orderbook, history, buy, sell, positions, orders, profile, cancel, cancel-all, cancel-market, leaderboard, activity, stream-market, stream-user | Prediction markets on Polygon |
| `dexscreener` | search, pairs, token, token-pairs, profiles, boosts, community-takeovers, ads, orders, trending, stream | Multi-chain DEX analytics |

### Solana

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `solana` | browse, price, transfer, send-token, swap, burn, close-accounts, lend, predict | Solana DeFi via Jupiter |

### Claude Code Integration

| Command | Subcommands | Purpose |
|---------|-------------|---------|
| `claude` | (default: setup), proxy, config | Claude Code wizard, local translation proxy, config via 0G Compute |

---

## Patterns

### Output modes
Every command supports two output modes:
- **UI mode** (interactive TTY): colored boxes, spinners, formatted tables via `utils/ui.ts`
- **JSON mode** (`--json` flag or headless detection): structured JSON on stdout via `utils/respond.ts` or `utils/output.ts`

Detection: `isHeadless()` checks `--json` flag, `ECHOCLAW_JSON=1`, or non-TTY stdout.

### Error handling
- Commands throw `EchoError` with code, message, hint
- Global handler in `cli-runtime.ts` formats as JSON or UI box
- Commander errors (unknown option, missing arg) caught separately

### Dual-mode commands (echo connect, echo fund)
- Interactive mode (TTY, no flags): launch `runEchoMenu()` interactive wizard
- Headless mode (`--json`, `--plan`, `--apply`): deterministic JSON operations

### Pre-action hook
`cli-auto-update.ts` runs before every command to check for updates (one-shot auto-update).

---

## File Counts

| Subfolder | Files | Key pattern |
|-----------|-------|-------------|
| echo/ | 27 | Largest — launcher, connect, fund, diagnostics, agent, wallet hub |
| kyberswap/ | 15 | swap, limit-order (create/cancel/fill/list), zap (in/out/migrate/search) |
| dexscreener/ | 13 | Read-only analytics, WS streaming |
| 0g-storage/ | 11 | Virtual drive with local↔network sync |
| polymarket/ | 10 | Full CLOB trading lifecycle |
| onboard/ | 10 | 8-step interactive wizard |
| 0g-compute/ | 9 | Provider management, ledger, monitor |
| echobook/ | 9 | Social platform (posts, follows, points) |
| jaine/ | 9 | DEX with subgraph integration |
| khalani/ | 9 | Cross-chain bridge + order tracking |
| solana/ | 8 | Jupiter-powered DeFi |
| slop/ | 8 | Bonding curve trading |
| wallet/ | 7 | EVM + Solana keystore |
| chainscan/ | 6 | Explorer queries |
| slop-app/ | 5 | Social APIs |
| claude/ | 4 | Proxy + config |
| marketmaker/ | 4 | Bot daemon + orders |
| update/ | 3 | Auto-update management |
| Root files | 5 | config, send, setup, skill, slop-stream |
| **Total** | **171** | |

---

## Dependencies

Commands import from:
- `tools/*` — protocol clients, wallet operations, chain data
- `config/*` — config store, paths
- `utils/*` — UI, output, validation, logging
- `bot/*` — MarketMaker daemon and stream (marketmaker/ commands)
- `claude/*` — proxy server (claude/ commands)
- `providers/*` — runtime detection, env resolution
- `openclaw/*` — config patching, webhook hooks
- `intents/*` — transfer intent store (send command)
- `guardrails/*` — wallet mutation guard
- `errors.ts` — `EchoError` with codes

---

## Tests

```bash
npx vitest run src/__tests__/cli/           # CLI bootstrap, command trees
npx vitest run src/__tests__/solana/        # Solana command tests
npx vitest run src/__tests__/dexscreener/   # DexScreener tests
# ... etc — each protocol has matching test folder in src/__tests__/
```
