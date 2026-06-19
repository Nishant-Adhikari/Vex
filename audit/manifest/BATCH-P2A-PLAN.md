# Batch P2-A — Protocol validation barrel splits (A-034, A-035, A-040, A-042)

**Baseline:** `HEAD == origin/main == 8bd0dfc`. Clean tree. 4 Opus agents parallel, file-disjoint, all root `src/`. Nested-subdir convention. ZERO behavior change. Each is a pure Zod-schema validator file → split per RESOURCE GROUP behind a barrel.

**Pattern (all four):** the original `validation.ts` becomes a BARREL re-exporting the IDENTICAL export set (read it first — `validate*` functions + any exported types). New modules under `<dir>/validation/` group the schemas + their validate functions by resource. Move code VERBATIM (same Zod schemas, same error messages, same return types). Single-source any shared schema/helper. No module imports its own barrel. Add a `*-surface.test.ts` pinning the exact runtime export-key set.

## A-034 — `src/tools/polymarket/clob/validation.ts` (383, 20 fns)
Group under `clob/validation/` by resource (orders / markets+prices / trades / batch / scoring — agent decides from content). Barrel re-exports all 20.
Importer (untouched): `polymarket/clob/client.ts`. Guard: `polymarket-clob-validation-equivalence.test.ts`.

## A-035 — `src/tools/polymarket/data/validation.ts` (379, 13 fns)
Group under `data/validation/` (positions / activity+trades / market-stats / leaderboard). Barrel re-exports all 13.
Importer (untouched): `polymarket/data/client.ts`. Guard: `polymarket-data-validation-equivalence.test.ts`.

## A-040 — `src/tools/khalani/validation.ts` (633, 12 fns) — thin direct test coverage
Group under `khalani/validation/` (chains / tokens / quotes / deposits / submit+orders / errors). Keep `parseKhalaniErrorBody`, `isSolanaAddressLike` single-sourced. Barrel re-exports all 12.
Importers (untouched): `khalani/helpers.ts`, `khalani/client.ts`. Guard: tsc + surface (no dedicated unit test — pure schemas; verify via integrated typecheck + the surface export pin).

## A-042 — `src/tools/dexscreener/validation.ts` (562, 14 fns) — thin direct test coverage
Group under `dexscreener/validation/` (pairs+search+tokens / profiles / boosts / orders / websocket / community+ads). Preserve the generic `validateWsHandshake<T>` signature. Barrel re-exports all 14.
Importer (untouched): `dexscreener/client.ts`. Guard: tsc + surface.

## Verification (owned by main Claude)
root `tsc` + `vex-app lint` + root vitest over the 2 equivalence guards + 4 surface tests. git scope: 4 barrels + 4 subdirs + 4 surface; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. For each file: read the EXACT export set (functions + any exported types) so the barrel + surface test preserve all of them. Any exported TYPE (not just functions) I must keep on the barrel?
2. Any shared private Zod schema/helper across resource groups to single-source (avoid duplication)? e.g. a shared error/pagination schema.
3. A-040/A-042 have no dedicated unit test — is a verbatim schema move + barrel + surface + tsc sufficient, or is there a specific validator branch to pin?
4. Any handler/client coupling where the client imports a NON-validate symbol from validation.ts that I must keep on the barrel? Cite.
5. Anything to serialize / extra guard.
