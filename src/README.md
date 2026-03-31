# EchoClaw — Source Directory

> CLI for 0G Network, Solana, and 20 EVM chains. Trading, bridging, storage, AI compute, social platform, and autonomous agent. **585 TypeScript files** across 18 modules.
>
> **Last updated: 2026-03-31**
>
> **LLM maintainers:** If you add/remove a top-level module, update this file. Each module has its own .md with detailed docs — update those when modifying files within.

---

## Hierarchy

```
src/
│
├── cli.ts                  — Entry point: Commander.js program, command registration
├── cli-runtime.ts          — Command tree builder, global error handler, preAction hooks
├── cli-auto-update.ts      — Pre-action hook: auto-update check on every command
├── errors.ts               — EchoError class, ErrorCodes enum (shared across all modules)
├── suppress-warnings.ts    — Node.js deprecation warning suppressor
├── agent-shim.ts           — Temporary shim for deleted src/agent/ (TODO: migrate to echo-agent/)
│
├── config/                 — App configuration & path constants
│   ├── paths.ts            — All filesystem paths (platform-aware config dir)
│   ├── store.ts            — EchoConfig type, load/save with deep merge
│   └── CONFIG.md
│
├── constants/              — Shared constants
│   └── chain.ts            — 0G chain defaults, contract addresses (Jaine, Slop)
│
├── commands/               — CLI command tree (171 files, 18 subfolders)
│   ├── 0g-compute/         — 0G Compute: setup, providers, ledger, monitor
│   ├── 0g-storage/         — 0G Storage: virtual drive, notes, backup
│   ├── chainscan/          — Block explorer queries
│   ├── claude/             — Claude Code proxy setup & config
│   ├── dexscreener/        — Multi-chain DEX analytics
│   ├── echo/               — Main hub: connect, fund, agent, wallet, diagnostics
│   ├── echobook/           — Social trading platform
│   ├── jaine/              — 0G DEX: swap, LP, pools
│   ├── khalani/            — Cross-chain bridge (40+ chains)
│   ├── kyberswap/          — Multi-chain EVM swaps & limit orders
│   ├── marketmaker/        — Trading bot daemon + orders
│   ├── onboard/            — Interactive 8-step setup wizard
│   ├── polymarket/         — Prediction markets on Polygon
│   ├── slop/               — Bonding curve trading
│   ├── slop-app/           — Slop.money social APIs
│   ├── solana/             — Solana DeFi via Jupiter
│   ├── update/             — Auto-update management
│   ├── wallet/             — EVM + Solana keystore ops
│   ├── config.ts, send.ts, setup.ts, skill.ts, slop-stream.ts
│   └── COMMANDS.md
│
├── tools/                  — Protocol clients & service integrations (167 files, 13 modules)
│   ├── 0g-compute/         — 0G SDK wrapper, readiness, monitor daemon
│   ├── 0g-storage/         — File ops, virtual drive index
│   ├── chainscan/          — ChainScan API client (Etherscan-compat)
│   ├── dexscreener/        — REST + WS analytics client
│   ├── echobook/           — Social platform API (auth, posts, follows, points)
│   ├── jaine/              — Uniswap V3 fork: routing, pools, subgraph, ABIs
│   ├── khalani/            — Cross-chain bridge API + EVM/Solana signers
│   ├── kyberswap/          — Aggregator, limit orders, ZaaS, token API
│   ├── polymarket/         — CLOB, Gamma, Relayer, bridge, data APIs
│   ├── slop/               — Bonding curve math, auth, contract ABIs
│   ├── slop-app/           — Profile, chat, image, agent query APIs
│   ├── solana-ecosystem/   — Jupiter (swap, prices, tokens, lend, predict) + shared utils
│   ├── wallet/             — Keystore (AES-256-GCM), viem/Solana clients, balances
│   └── TOOLS.md
│
├── echo-agent/             — Autonomous AI agent (149 files)
│   ├── db/                 — SQLite database, migrations, 20+ repos
│   ├── engine/             — Turn loop, runner, missions, prompts, subagents
│   ├── inference/          — Model registry, cost calculation, resilience
│   ├── sync/               — Balance sync, position projection, activity populator
│   ├── tools/              — Protocol handlers, internal tools, tool registry
│   └── ECHO-AGENT.md, ENGINE.md, DB.md, INFERENCE.md, SYNC.md, TOOLS.md
│
├── bot/                    — MarketMaker trading daemon (9 files)
│   ├── daemon.ts, executor.ts, triggers.ts, orders.ts, stream.ts, ...
│   └── BOT.md
│
├── claude/                 — Anthropic-to-OpenAI translation proxy (3 files)
│   ├── proxy.ts, translate.ts, constants.ts
│   └── CLAUDE.md
│
├── launcher/               — Local web dashboard & REST API (23 files)
│   ├── server.ts, routes.ts, handlers/, ui/
│   └── LAUNCHER.md
│
├── providers/              — AI runtime detection & skill installation (8 files)
│   ├── registry.ts, claude-code.ts, codex.ts, openclaw.ts, other.ts, ...
│   └── PROVIDERS.md
│
├── openclaw/               — OpenClaw agent gateway integration (2 files)
│   ├── config.ts, hooks-client.ts
│   └── OPENCLAW.md
│
├── password/               — Keystore password health & compatibility (2 files)
│   ├── health.ts, compat.ts
│   └── PASSWORD.md
│
├── update/                 — Auto-update & runtime update system (8 files)
│   ├── updater.ts, auto-update-worker.ts, cli-bootstrap.ts, runtime-update-*, ...
│   └── UPDATE.md
│
├── utils/                  — Shared utilities (16 files)
│   ├── logger.ts, output.ts, respond.ts, ui.ts, http.ts, dotenv.ts, env.ts, ...
│   └── UTILS.md
│
├── guardrails/             — Transaction safety guards (1 file)
│   └── wallet-mutation.ts  — Wallet mutation guardrail (blocks dangerous ops)
│
├── intents/                — Transfer intent store (2 files)
│   ├── store.ts            — Prepare/confirm pattern for native transfers
│   └── types.ts
│
├── setup/                  — One-off setup utilities (1 file)
│   └── openclaw-link.ts    — Symlink EchoClaw skill into OpenClaw
│
├── shared/                 — Cross-module shared code (1 file)
│   └── runtime-catalog.ts  — Runtime catalog (protocols, chains, capabilities)
│
└── __tests__/              — Test suite (27 domain folders + echo-agent/)
    ├── setup.ts            — Vitest setup (auto-loaded)
    ├── 0g/, bot/, chainscan/, claude/, cli/, config/, daemon/, ...
    ├── echo-agent/         — Engine, sync, inference, tools tests
    └── (see vitest.config.ts for glob patterns)
```

---

## Data Flow

```
User (CLI)                              Agent (echo-agent)
  │                                       │
  echoclaw <command> [opts]               LLM turn → tool_use
  │                                       │
  ▼                                       ▼
commands/                               echo-agent/tools/
  │                                       │
  ├── tools/* (protocol clients)    ◄─────┘
  ├── config/* (settings)
  ├── utils/* (output, logging)
  └── wallet/* (signing)
          │
          ▼
      On-chain / External APIs
```

CLI commands and echo-agent tools share the same `tools/*` protocol clients. No logic duplication — commands handle UI, echo-agent handles LLM tool dispatch.

---

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| `stdout` = data, `stderr` = UI | Enables piping (`echoclaw wallet balance \| jq`) |
| Headless auto-detection | `--json`, `ECHOCLAW_JSON=1`, non-TTY → JSON mode |
| Atomic file writes everywhere | tmp + rename pattern — crash-safe config/keystore |
| AES-256-GCM + scrypt | No external crypto deps, industry-standard keystore |
| Single config file | `~/.echoclaw/config.json` — all chain/protocol/wallet config |
| Protocol-per-folder | Each integration self-contained with types, validation, client |
| Commander.js command tree | Lazy registration, each subfolder is `create*Command()` factory |

---

## Quick Reference

| Task | Entry point |
|------|-------------|
| Add new CLI command | `src/commands/<name>/index.ts` → register in `cli-runtime.ts` |
| Add new protocol client | `src/tools/<name>/` → types, client, validation, errors |
| Add echo-agent tool | `src/echo-agent/tools/protocols/<name>/` → handlers + manifest |
| Add test | `src/__tests__/<domain>/` → vitest, auto-discovered |
| Change config shape | `src/config/store.ts` → `EchoConfig` type + defaults |
| Add path constant | `src/config/paths.ts` |
| Modify error codes | `src/errors.ts` → `ErrorCodes` enum |
