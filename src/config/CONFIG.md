# Config — Application Configuration & Paths

> Central configuration store and platform-aware path constants. All file-based state across EchoClaw flows through paths defined here.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove paths, update config shape, fix stale references.

---

## Directory Structure

```
src/config/
  paths.ts    — All filesystem path constants (platform-aware config dir)
  store.ts    — EchoConfig type, load/save with deep merge + atomic write
```

---

## Config Directory Location

Platform-resolved at runtime (`paths.ts`):

| Platform | Path |
|----------|------|
| Linux | `~/.config/echoclaw/` (respects `$XDG_CONFIG_HOME`) |
| macOS | `~/Library/Application Support/echoclaw/` |
| Windows | `%APPDATA%/echoclaw/` |

---

## File Map (`paths.ts`)

All paths are derived from `CONFIG_DIR`:

| Export | Path | Used by |
|--------|------|---------|
| `CONFIG_FILE` | `config.json` | Core config (chain, protocol, wallet, services) |
| `KEYSTORE_FILE` | `keystore.json` | EVM encrypted keystore |
| `SOLANA_KEYSTORE_FILE` | `solana-keystore.json` | Solana encrypted keystore |
| `ENV_FILE` | `.env` | App-specific env vars (provider-neutral) |
| `JWT_FILE` | `jwt.json` | EchoBook JWT cache |
| `SLOP_JWT_FILE` | `slop-jwt.json` | Slop auth JWT cache |
| `INTENTS_DIR` | `intents/` | Transfer intent store |
| `STORAGE_DRIVE_FILE` | `storage-drive.json` | 0G Storage virtual drive index |
| `BACKUPS_DIR` | `backups/` | Wallet backup archives |
| `SOLANA_TOKEN_CACHE_FILE` | `solana-token-cache.json` | Jupiter token metadata cache |
| **Bot** | | |
| `BOT_DIR` | `bot/` | Bot data directory |
| `BOT_ORDERS_FILE` | `bot/orders.json` | Armed/filled/cancelled orders |
| `BOT_STATE_FILE` | `bot/state.json` | Execution log, daily spend, hourly tx |
| `BOT_PID_FILE` | `bot/bot.pid` | Daemon PID (single-instance guard) |
| `BOT_SHUTDOWN_FILE` | `bot/bot.shutdown` | File-based shutdown signal (Windows) |
| `BOT_LOG_FILE` | `bot/bot.log` | Daemon log |
| **Launcher** | | |
| `LAUNCHER_DIR` | `launcher/` | Launcher data directory |
| `LAUNCHER_PID_FILE` | `launcher/launcher.pid` | Launcher PID |
| `LAUNCHER_LOG_FILE` | `launcher/launcher.log` | Launcher log |
| `LAUNCHER_DEFAULT_PORT` | `4200` | Default launcher HTTP port |

---

## EchoConfig (`store.ts`)

Main config type with sections:

| Section | Fields | Purpose |
|---------|--------|---------|
| `chain` | chainId, rpcUrl, explorerUrl | 0G network connection |
| `protocol` | w0g, jaineFactory, jaineRouter, nftPositionManager, quoter, w0gUsdcPool | Jaine DEX contract addresses |
| `slop` | factory, tokenRegistry, feeCollector, graduationModule, securityModule, configVault, lpFeesHelper, revenueDistributor | Slop.money contract addresses |
| `wallet` | address (EVM), solanaAddress | Active wallet addresses |
| `services` | 15 API/WS URLs | External service endpoints (Khalani, KyberSwap, DexScreener, Jupiter, ChainScan, etc.) |
| `solana` | cluster, rpcUrl, explorerUrl, commitment, jupiterApiKey | Solana network config |
| `polymarket?` | clobBaseUrl, gammaBaseUrl, dataApiBaseUrl | Polymarket endpoints (optional) |
| `claude?` | provider, model, providerEndpoint, proxyPort | Claude proxy config (optional) |

### Load behavior

`loadConfig()`:
1. Ensures config dir exists
2. If no file → returns hardcoded defaults (all contract addresses, service URLs baked in)
3. If file exists → deep merge with defaults (new fields from defaults fill gaps)
4. Version check: rejects non-v1 configs
5. Strips legacy `watchlist` field silently
6. Validates `claude` section shape explicitly

### Save behavior

`saveConfig()`: atomic write via tmp file + `rename()` (crash-safe, no partial writes).

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `constants/chain.ts` | `CHAIN`, `PROTOCOL`, `SLOP` — hardcoded contract addresses and network defaults |
| `utils/logger.ts` | Debug/warn logging |

---

## Consumed by

Nearly every module in the codebase imports from `config/`:
- `paths.ts` — used by bot, launcher, wallet, update, claude, storage, and more
- `store.ts` — used by all commands, tools, providers, executor

---

## Tests

```bash
npx vitest run src/__tests__/config/
```

| File | Coverage |
|------|----------|
| `config.test.ts` | Load/save, deep merge, version validation, atomic write |
| `connect-plan-defaults.test.ts` | Runtime scope defaults |
| `dotenv.test.ts` | .env file parsing |
| `env-resolution.test.ts` | Provider env resolution |
| `env.test.ts` | Environment variable handling |
