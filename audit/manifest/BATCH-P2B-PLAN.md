# Batch P2-B — clob-client, khalani-balances, jupiter-schemas, wallet-schemas (A-033, A-041, A-043, A-048)

**Baseline:** `HEAD == origin/main == 0bae0ec`. Clean tree. 4 Opus agents parallel, file-disjoint. Nested-subdir convention. ZERO behavior change. A-048 is vex-app/shared (cross-project verify: root tsc + vex-app lint).

## A-033 — `src/tools/polymarket/clob/client.ts` (365) — a CLASS (honest-minimal)
**Façade exports (exact):** `ClobAuthContext` (interface), `PolyClobClient` (class), `getPolyClobClient` (function). The class STAYS in client.ts.
Extract ONLY clearly-stateless helpers the methods call (auth-header/signature build, request/response shaping) into `client/{auth,http}.ts` as functions. If a method is heavily this-bound (this.creds/this.http), LEAVE IT in the class. Honest-minimal — invent nothing. getPolyClobClient (singleton accessor) stays.
Importers (untouched): polymarket clob handlers + credential flows. Guard: polymarket-clob tests + clob handler tests.

## A-041 — `src/tools/khalani/balances.ts` (383)
**Façade exports (exact, 7):** `BalanceChainError`, `BalanceChainSelection`, `TokenBalanceScanResult` (types), `parseBalanceChainSelection`, `getSelectedChainIdsForFamily`, `getTokenBalancesAcrossChains`, `calculateTokensTotalUsd`.
New modules under `khalani/balances/`: `types.ts` (the 3 interfaces) · `selection.ts` (parseBalanceChainSelection, getSelectedChainIdsForFamily) · `scan.ts` (getTokenBalancesAcrossChains) · `aggregate.ts` (calculateTokensTotalUsd). Façade re-exports all 7.
Importer (untouched): khalani client/tools. Guard: khalani balances tests (if present) else tsc + surface.

## A-043 — `src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/schemas.ts` (537, 22 Zod schemas)
**Façade barrel re-exports all 22** `jupiterPrediction*Schema` consts. Types from inferred — preserve any exported types too (read first).
New modules under `prediction-api/schemas/` grouped by resource (events / markets / orderbooks / orders / positions / profile / pnl / trades / leaderboard / vault / transactions — agent groups from content). The base/private schemas (eventSchema, marketSchema, etc.) that multiple exports reference must be SINGLE-SOURCED in a shared module.
Importers (untouched): jupiter prediction service. Guard: jupiter-prediction-api-service test + surface.

## A-048 — `vex-app/src/shared/schemas/wallets.ts` (465, 81 exports) — SHARED contract (vex-app, cross-project)
**Barrel re-exports the IDENTICAL 81-export set** (Zod schemas + z.infer types). Read the full export list first.
New modules under `shared/schemas/wallets/` grouped by concern (status/chain / generate / import / export / restore / backup — agent groups; every export in exactly one module). MUST stay PURE (renderer imports it — no node/electron; process-boundary check enforces). Shared base schemas (chainSchema, evmAddressSchema, etc.) single-sourced.
Importers (untouched, many across main/preload/renderer): keep the barrel at `shared/schemas/wallets.ts`. Guard: vex-app wallet schema/IPC tests + whole-project tsc + boundary check.

## Verification (owned by main Claude)
root `tsc` + `vex-app lint` (whole project + boundary — A-048's net) + vitest both projects over guards + 4 surface tests. git scope: 4 façades/barrels + 4 subdirs + 4 surface; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. A-033: which PolyClobClient logic is cleanly stateless-extractable (auth/signature/request build) vs must stay this-bound? Honest-minimal the right call? Cite lines.
2. A-043: list any EXPORTED types (not just *Schema consts) + the private base schemas (eventSchema/marketSchema/...) shared across exports that must be single-sourced. Cite lines.
3. A-048 (key risk): give the EXACT 81-export set grouping (which schemas/types go where), the shared base schemas to single-source, and confirm the tree stays pure (no privileged import) + every importer uses the barrel path. Any export that is a re-export from another schema file? Cite lines.
4. A-041: any shared helper across selection/scan/aggregate? Cite.
5. Anything to serialize, or extra guard (esp. A-048 exact-81-key surface pin).
