# Slop — Bonding Curve Token Platform on 0G Network

> On-chain bonding curve math, JWT auth for slop.money backend, and contract ABIs for token trading. Pure bigint math matching `BondingCurveLib.sol` 1:1. Used by both CLI commands (`commands/slop/`) and the MarketMaker bot (`bot/executor.ts`).
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/tools/slop/
  auth.ts         — JWT auth: login (nonce+sign+verify), refresh, cache check
  jwtCache.ts     — JWT persistence (~/.vex/slop-jwt.json), access+refresh with expiry
  quote.ts        — Pure bigint bonding curve math (mirrors BondingCurveLib.sol)
  abi/
    token.ts      — SlopToken ABI (buy/sell, reserves, balances, graduation, fees)
    factory.ts    — SlopFactory ABI (createToken, getToken)
    registry.ts   — TokenRegistry ABI (isValidToken, getTokens)
    feeCollector.ts — FeeCollector ABI (claimFees, pendingFees)
    index.ts      — Re-exports
```

---

## Bonding Curve Math (`quote.ts`)

Pure bigint functions matching `BondingCurveLib.sol` exactly. Zero floating point — all math in wei (18 decimals).

### Core formulas

| Function | Formula | Purpose |
|----------|---------|---------|
| `calculateTokensOut(k, ogRes, tokRes, ogIn)` | `tokRes - ceil(k / (ogRes + ogIn))` | Tokens received for 0G input (after fee) |
| `calculateOgOut(k, ogRes, tokRes, tokIn)` | `ogRes - ceil(k / (tokRes + tokIn))` | 0G received for token input (before fee) |
| `calculateSpotPrice(ogRes, tokRes)` | `(ogRes × 10^18) / tokRes` | Current price per token in 0G |
| `calculatePartialFill(...)` | Caps at 80% graduation threshold | Buy with graduation-aware partial fill |
| `applySlippage(amount, bps)` | `amount × (10000 - bps) / 10000` | Minimum acceptable output |
| `calculateGraduationProgress(...)` | `tokensSold × 10000 / curveSupply` | Progress in basis points (8000 = graduates) |

### Rounding

Uses `ceilDiv(a, b)` — ceiling division (rounds UP), protocol-favoring. Matches SLO-12 spec: `newReserves` rounds up → output rounds down.

### Graduation

Token graduates when 80% of `CURVE_SUPPLY` is sold. After graduation, bonding curve trading is disabled — token migrates to Jaine DEX pool.

`calculatePartialFill()` handles the edge case: if buy would push past 80%, it caps at remaining tokens, calculates exact 0G needed, and returns `refund`.

---

## Auth (`auth.ts` + `jwtCache.ts`)

JWT auth for slop.money backend API (chat notifications, profile).

### Flow

```
requireSlopAuth(privateKey, walletAddress, baseUrl)
  ├── loadCachedSlopJwt() → if access valid (60s buffer) → return
  ├── if refresh token valid → slopRefresh() → cache new pair → return
  └── slopLogin()
        ├── POST /auth/nonce { walletAddress }
        ├── Sign message with wallet (EIP-191)
        ├── POST /auth/verify { walletAddress, signature, message }
        └── Cache { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }
```

### Cache

File: `~/.vex/slop-jwt.json`. Stores both access + refresh tokens with decoded expiry. Wallet mismatch → clear cache and re-login.

---

## ABIs (`abi/`)

| ABI | Contract | Key functions |
|-----|----------|---------------|
| `token.ts` | SlopToken | `buyWithSlippage`, `sellWithSlippage`, `ogReserves`, `tokenReserves`, `virtualOgReserves`, `virtualTokenReserves`, `k`, `CURVE_SUPPLY`, `buyFeeBps`, `sellFeeBps`, `isGraduated`, `isTradingEnabled`, `balanceOf` |
| `factory.ts` | SlopFactory | `createToken`, `getToken`, `getTokenCount` |
| `registry.ts` | TokenRegistry | `isValidToken`, `getTokens`, `getTokenCount` |
| `feeCollector.ts` | FeeCollector | `claimFees`, `pendingFees`, `claimedFees` |

Contract addresses from `config.slop.*` (see `config/store.ts`).

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `viem` | `privateKeyToAccount` for message signing |
| `utils/http.ts` | `fetchJson()` for auth API calls |
| `config/paths.ts` | `SLOP_JWT_FILE` |
| `config/store.ts` | `ensureConfigDir()` |
| `errors.ts` | `VexError`, `ErrorCodes` |

---

## Consumed by

- `bot/executor.ts` — `calculateTokensOut`, `calculateOgOut`, `calculatePartialFill`, `applySlippage` + ABIs for on-chain trades
- `bot/notify.ts` — `requireSlopAuth` for chat notifications
- `commands/slop/` — all CLI commands (token, trade, price, curve, fees, reward)
- `vex-agent/tools/protocols/0g/slop/` — vex-agent protocol handlers

---

## Tests

```bash
npx vitest run src/__tests__/slop/
```

| File | Coverage |
|------|----------|
| `slopAuth.test.ts` | Login flow, refresh, cache check, wallet mismatch |
| `slopJwtCache.test.ts` | JWT persistence, expiry detection, access/refresh validity |
| `slopQuote.test.ts` | All bonding curve math: tokensOut, ogOut, spotPrice, partialFill, graduation, slippage |
