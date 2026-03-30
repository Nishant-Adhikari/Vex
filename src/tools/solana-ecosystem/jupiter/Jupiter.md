# Jupiter in `src/tools`

Local source-of-truth for Jupiter integrations under `src/tools/solana-ecosystem/jupiter`.

## Verified From
- `https://dev.jup.ag/docs/llms.txt`
- `https://dev.jup.ag/docs/swap/index.md`
- `https://dev.jup.ag/docs/swap/order-and-execute.md`
- `https://dev.jup.ag/docs/swap/build/index.md`
- `https://dev.jup.ag/docs/swap/fees.md`
- `https://dev.jup.ag/docs/swap/migration.md`
- `https://dev.jup.ag/docs/swap/routing/index.md`
- `https://dev.jup.ag/docs/swap/advanced/index.md`
- `https://dev.jup.ag/guides/how-to-get-token-price.md`
- `https://dev.jup.ag/openapi-spec/price/v3/price.yaml`
- `https://dev.jup.ag/portal/migrate-from-lite-api`
- Verified on `2026-03-30`

## Purpose
- Keep Jupiter protocol integrations organized outside legacy `src/tools/chains/*`.
- Store stable API contracts and local implementation notes for future LLM work.
- Avoid snapshotting dynamic portal pricing, tier limits, or billing tables.

## Current Status
- Implemented now:
  - `jupiter-swaps/` for Jupiter Swap API V2.
  - `jupiter-prices/` for Jupiter Price API V3.
  - `jupiter-tokens/` for Tokens API V2 and Token Content API.
  - `jupiter-lend/` for Jupiter Lend Earn REST.
- Planned next:
  - perps
  - prediction
  - orders
  - studio
  - send
  - stake
  - deeper lend work: Borrow, Flashloan, Read SDK, Oracles, Liquidity analytics

## Folder Layout
```text
src/tools/solana-ecosystem/jupiter/
├── index.ts
├── Jupiter.md
├── jupiter-prices/
│   ├── client.ts
│   ├── service.ts
│   ├── types.ts
│   ├── validation.ts
│   ├── index.ts
│   └── JupiterPrices.md
├── jupiter-lend/
│   ├── index.ts
│   ├── constants.ts
│   ├── JupiterLend.md
│   └── earn-api/
│       ├── client.ts
│       ├── service.ts
│       ├── types.ts
│       ├── validation.ts
│       ├── index.ts
│       └── JupiterLendEarnApi.md
├── jupiter-tokens/
│   ├── client.ts
│   ├── service.ts
│   ├── types.ts
│   ├── validation.ts
│   ├── index.ts
│   ├── JupiterTokens.md
│   └── content/
│       ├── client.ts
│       ├── service.ts
│       ├── types.ts
│       ├── validation.ts
│       ├── index.ts
│       └── JupiterTokenContent.md
├── jupiter-swaps/
    ├── client.ts
    ├── service.ts
    ├── types.ts
    ├── validation.ts
    ├── index.ts
    └── JupiterSwaps.md
```

## Design Rules
- `client.ts` is wire-first and maps directly to Jupiter HTTP endpoints.
- `types.ts` preserves full response shapes instead of flattening them into CLI-only DTOs.
- `service.ts` may add convenience summaries, token resolution, UI amount conversion, and signing, but must keep the raw response available.
- `validation.ts` owns request contract checks and API key requirements.
- `src/tools/solana-ecosystem/jupiter/**/*` must not import legacy `src/tools/chains/solana/*`.

## API Key Policy
- Jupiter Swap V2, Tokens API V2, Token Content API, and Jupiter Lend Earn REST require `x-api-key`.
- Local resolution order:
  1. `process.env.JUPITER_API_KEY`
  2. `loadConfig().solana.jupiterApiKey`
- Do not add `lite-api.jup.ag` fallback in this module.

## Documentation Policy
- Keep stable endpoint contracts, parameter semantics, and migration notes locally.
- Link out for unstable commercial data:
  - `https://portal.jup.ag/pricing`
  - `https://dev.jup.ag/portal/rate-limit.md`
  - `https://dev.jup.ag/portal/setup.md`

## Notes For Future Migration
- Legacy `src/tools/chains/solana/*` consumers are intentionally not rewired in this pass.
- Rewiring should happen only after the new Jupiter shelves are complete enough to replace their legacy surfaces.
- `content/summaries` is implemented from official docs guidance plus sibling content schemas because Jupiter does not currently expose a dedicated reference page for it in the docs index.
- Jupiter Lend advanced guides that still depend on `lite-api.jup.ag` are explicitly deferred in the new shelf rather than reimplemented here.
