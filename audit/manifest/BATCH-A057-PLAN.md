# Batch A-057 — dotmatrix-core.tsx split (visual primitive module)

**Baseline:** `HEAD == origin/main == 01d1b33`. Clean tree. 1 Opus agent. NO existing test (visual file) — so the guard is **byte-identity of moved code + export-surface preservation + tsc/boundary + consumers compile + a NEW render smoke test**. Done sequentially BEFORE A-058 (they both otherwise touch this file).

## File: `vex-app/src/renderer/components/ui/dotmatrix-core.tsx` (960) — primitives + ONE React component
~85 pure exports (types, geometry/pattern math, color, bloom, layout, path-norm order maps) + the React component `DotMatrixBase` (689-900) + factories `createPathWaveResolver`/`createPathWaveComponent` (901-960). Line 3 is a CSS side-effect import `import "../dotmatrix-loader.css"`. Importers (UNTOUCHED): `dotm-circular-8.tsx`, `dotm-square-3.tsx`, `dotm-hex-3.tsx`, `dotmatrix-hooks.ts`, `stepper-loader-variants.ts` — they import named symbols.

## Split into `dotmatrix-core/` (nested), façade re-exports EVERY symbol + keeps the CSS import
- `types.ts` — public types: `MatrixPattern`, `DotShape`, `DotMatrixPhase`, `DotMatrixColorPreset`, `DotMatrixCommonProps`, `DotAnimationContext`, `DotAnimationState`, `DotAnimationResolver`.
- `util.ts` — `cx`, `stylePx`, `styleOpacity` (+ keep private helpers they need local).
- `color.ts` — `resolveDmxColorTokens`.
- `patterns.ts` — `MATRIX_SIZE`, `RANGE`, `rowMajorIndex`, `indexToCoord`, `FULL_INDEXES`, `DIAMOND_INDEXES`, `OUTLINE_INDEXES`, `CROSS_INDEXES`, `RINGS_INDEXES`, `ROSE_INDEXES`, `getPatternIndexes`.
- `geometry.ts` — `distanceFromCenter`, `rowDistance`, `polarAngle`, `normalizedRadius`, `manhattanDistance`, `harmonicPhase`, `lissajousOffset`, `spiralOffset`, `isPrime`.
- `path-norms.ts` — the order-map block (264-518): `trBlPathNormFromIndex`, snake/spiralInward/outerRing/middleRing/diagonalSnake/rowWave/colWave/concentricRing norm+order fns + their builder helpers + module consts (`SNAKE_ORDER`, etc.) + `isWithinCircularMask`. KEEP each builder/const BEFORE its consumers (order-sensitive).
- `bloom.ts` — `dmxBloomRootActive`, `dmxBloomHaloSpreadClass`, `dmxDotBloomParts` + the opacity consts/helpers (`SOURCE_*_OPACITY`, `clamp01Dmx`, `lerpDmx`, `normalizeProgressDmx`).
- `layout.ts` — `getMatrix5Layout`, `resolveDmxBoxOuterDim`.
- `base.tsx` — `DotMatrixBase` (+ its local types `DotMatrixBaseProps`, `NormFn`, `PathWaveComponentProps`), `createPathWaveResolver`, `createPathWaveComponent`. JSX MOVED BYTE-IDENTICAL (any whitespace/JSX change is a visual risk — do NOT reformat).
- Façade `dotmatrix-core.tsx` → `import "../dotmatrix-loader.css";` (KEEP, side effect) + `export *` / `export type *` from each module so the EXACT public surface is preserved. Importers unchanged.

**HARD invariants:** (1) the CSS side-effect import stays at the façade so consumers still load styles; (2) `DotMatrixBase` JSX + the factories move byte-identical (no reformat, no JSX edit) → identical render; (3) every currently-exported name remains exported from the façade with the same type; (4) cross-module imports use ESM `.js` specifiers; (5) order-sensitive module consts keep their relative order.

## NEW guard (the file has none): render smoke test
`vex-app/src/renderer/components/ui/__tests__/DotMatrixBase-smoke.test.tsx` (renderer/jsdom project): render a `DotMatrixBase` (and one `createPathWaveComponent` output) with minimal valid props for a couple of patterns; assert it renders without throwing and produces the expected dot cells (e.g. `container.querySelectorAll('[class*="dmx"]').length` matches `MATRIX_SIZE*MATRIX_SIZE` or the pattern's index count). Pins gross visual/structural regression.

## Verification (owned by main Claude)
1. Byte-identity: reconstruct the original from the extracted modules (concat the moved blocks) and diff against HEAD — moved code byte-identical (esp. the `DotMatrixBase` JSX).
2. Export-surface: the façade re-exports the EXACT set of names the original exported (compare `grep '^export'` name sets).
3. `pnpm --dir vex-app lint` (tsc -p + boundary) EXIT 0 — proves all 5 consumers + the new modules typecheck.
4. Renderer vitest over the new smoke test → passes.
5. git scope: 1 façade modified + 1 new subdir + 1 new smoke test; ZERO importer files; `dotmatrix-loader.css` UNTOUCHED. Codex final → 1 commit → FF push. **Residual: recommend a manual screenshot check post-merge (no full visual diff in CI).**

## Codex corrections (AUTHORITATIVE — supersede the sketch above)
**Façade uses EXPLICIT re-exports (NOT `export *`)** because `verbatimModuleSyntax:true`+`isolatedModules:true` (tsconfig.base.json) and because some module-scope symbols are PRIVATE and must not leak. The façade re-exports EXACTLY this surface:
- **8 types** via `export type { … } from …`: `MatrixPattern`, `DotShape`, `DotMatrixPhase`, `DotMatrixColorPreset`, `DotMatrixCommonProps`, `DotAnimationContext`, `DotAnimationState`, `DotAnimationResolver`.
- **49 values** via `export { … } from …`: `MATRIX_SIZE`, `FULL_INDEXES`, `DIAMOND_INDEXES`, `OUTLINE_INDEXES`, `CROSS_INDEXES`, `RINGS_INDEXES`, `ROSE_INDEXES`, `getPatternIndexes`, `rowMajorIndex`, `indexToCoord`, `distanceFromCenter`, `rowDistance`, `polarAngle`, `normalizedRadius`, `manhattanDistance`, `harmonicPhase`, `lissajousOffset`, `spiralOffset`, `isPrime`, `trBlPathNormFromIndex`, `snakePathNormFromIndex`, `snakePathOrderValue`, `spiralInwardNormFromIndex`, `spiralInwardOrderValue`, `outerRingClockwiseNormFromIndex`, `outerRingClockwiseOrderValue`, `middleRingAntiClockwiseNormFromIndex`, `middleRingAntiClockwiseOrderValue`, `diagonalSnakeNormFromIndex`, `diagonalSnakeOrderValue`, `rowWaveNormFromIndex`, `rowWaveOrderValue`, `colWaveNormFromIndex`, `concentricRingNormFromIndex`, `isWithinCircularMask`, `stylePx`, `styleOpacity`, `cx`, `resolveDmxColorTokens`, `dmxBloomRootActive`, `dmxBloomHaloSpreadClass`, `dmxDotBloomParts`, `remapOpacityToTriplet`, `remappedOpacityQualifiesForBloom`, `opacityToBloomLevel`, `DMX_BLOOM_OPACITY_MIN`, `DotMatrixBase`, `createPathWaveResolver`, `createPathWaveComponent`.

**PRIVATE — keep OUT of the façade** (export from their leaf module ONLY for internal cross-module use; never re-export from `dotmatrix-core.tsx`): `RANGE`, `getMatrix5Layout`, `resolveDmxBoxOuterDim`, `clamp01Dmx`, `lerpDmx`, `normalizeProgressDmx`, `clampHalo`, `coerceOpacityDmx`, `SOURCE_BASE/MID/PEAK_OPACITY`, `DOT_MATRIX_COLOR_PRESETS`, `PATTERN_INDEXES`, `N`, `C`, `CELLS`, `CENTER`, `MAX_RADIUS`, `MAX_TRBL`, `CORNER_COORDS`, the `*_ORDER` consts (`SNAKE_ORDER`, `SPIRAL_INWARD_ORDER`, `OUTER_RING_CLOCKWISE_ORDER`, `MIDDLE_RING_ANTI_CLOCKWISE_ORDER`, `DIAGONAL_SNAKE_ORDER`, `ROW_WAVE_SNAKE_ORDER`, `ROW_WAVE_SNAKE_MAX_ORDER`), and the `build*OrderToIndexMap` helpers.

- `bloom.ts` MUST contain the 4 public bloom symbols (`remapOpacityToTriplet`, `remappedOpacityQualifiesForBloom`, `opacityToBloomLevel`, `DMX_BLOOM_OPACITY_MIN`) + `dmxBloom*`/`dmxDotBloomParts`; private opacity helpers stay private.
- `DotMatrixBase` closes over private `getMatrix5Layout`, `resolveDmxBoxOuterDim`, `clamp01Dmx` (used ~line 718) — CO-LOCATE these in `base.tsx` (simplest) OR import them from their leaf module (which exports them for internal use). Either way they are NOT façade-re-exported.
- **Cycle avoidance:** internal modules import LEAF modules (e.g. `geometry.ts` imports `patterns.ts`), NEVER the façade. `dotmatrix-hooks.ts` only imports a type (erases — no runtime cycle).

**Smoke test (Codex's sharper assertions):** render `DotMatrixBase` for a couple patterns; assert `.dmx-grid` has exactly `MATRIX_SIZE*MATRIX_SIZE` children, every child has class `dmx-dot`, and the count of cells WITHOUT `dmx-inactive` equals `getPatternIndexes(pattern).length`; for a `createPathWaveComponent` output, assert an active dot carries the `--dmx-path` var / `dmx-path` behavior. No full DOM serialization. (Confirm the exact class names by reading the component before asserting.)

## Verification addendum
6. Export-surface diff: the façade's re-exported names == the original's `^export` set EXACTLY (8 types + 49 values); confirm NONE of the private list appears in the façade.

## Open questions for Codex
1. Is the module grouping sound (no circular import between geometry/patterns/path-norms/base)? Any export I mis-placed? Cite.
2. `DotMatrixBase`/factories: confirm a verbatim move preserves render; flag any closure over a module-private the split would break.
3. Façade `export *` vs `export type *` — given the repo's tsconfig (isolatedModules?), what's the correct re-export form so type-only symbols don't error? 
4. Is the smoke-test assertion (dot-cell count) a meaningful guard, or do you suggest a better cheap structural assertion? Anything to serialize.
