# Batch A-058 — dotmatrix-loader.css split (ordered pure-cut parts)

**Baseline:** `HEAD == origin/main == 26e19fa` (after A-057). Clean tree. 1 Opus agent. Pure CSS, no test — the guard is **byte-concatenation of the parts (in import order) === the original CSS** (proves identical cascade) + lint + the existing DotMatrixBase smoke test still loads/passes.

## File: `vex-app/src/renderer/components/dotmatrix-loader.css` (1121) — 32 rules + 17 @keyframes + 1 @media
Imported ONLY via the side-effect `import "../dotmatrix-loader.css"` in `dotmatrix-core.tsx` (the A-057 façade). No other importer.

## Split into ordered `dotmatrix-loader/` parts via PURE CUTS (NO added/removed bytes — no headers, no reformat)
Cut the file into 7 CONTIGUOUS slices at rule boundaries (between a `}` and the next selector/comment), so concatenating them in numeric order reproduces the original BYTE-FOR-BYTE. Suggested section boundaries (agent confirms exact cut lines by reading; each slice must contain WHOLE rules):
- `01-base.css`              ← `.dmx-root` / `.dmx-grid` / `.dmx-dot` / dot-shape variants / `.dmx-bloom .dmx-dot` (≈1-101).
- `02-bloom-states.css`      ← halo / muted / inactive (≈102-149).
- `03-animation-classes.css` ← the `.dmx-*` animation trigger classes: ripple, collapse, hover-ripple, path, sweeps, snakes (≈150-229).
- `04-keyframes-core.css`    ← core `@keyframes` (ripple…ring-snake) (≈230-424).
- `05-square9.css`           ← `.dmx-square9-*` classes + the 6 `@keyframes dmx-square9-d1..d6` (≈425-983; the big block).
- `06-misc-variants.css`     ← square6-col-snake + circular2-ring + their `@keyframes` (≈984-1101).
- `07-reduced-motion.css`    ← `@media (prefers-reduced-motion: reduce)` block to EOF (≈1102-1121).
DELETE the original `dotmatrix-loader.css`.

## Façade edit (the ONLY non-CSS change) — `vex-app/src/renderer/components/ui/dotmatrix-core.tsx`
Replace the single line `import "../dotmatrix-loader.css";` with 7 ordered side-effect imports, in the SAME numeric order (preserves cascade exactly, and JS-side CSS imports are fully supported by Vite/Tailwind v4 — unlike a CSS `@import` barrel which we are deliberately NOT using):
```
import "../dotmatrix-loader/01-base.css";
import "../dotmatrix-loader/02-bloom-states.css";
import "../dotmatrix-loader/03-animation-classes.css";
import "../dotmatrix-loader/04-keyframes-core.css";
import "../dotmatrix-loader/05-square9.css";
import "../dotmatrix-loader/06-misc-variants.css";
import "../dotmatrix-loader/07-reduced-motion.css";
```
(Note the path: the CSS subdir is `components/dotmatrix-loader/`, and the façade is in `components/ui/`, so the specifier is `../dotmatrix-loader/0X-...css` — same `../` depth as the original `../dotmatrix-loader.css`.) Do NOT touch anything else in the façade.

## HARD invariant
The parts, concatenated in import order (01→07), MUST be byte-identical to the original `dotmatrix-loader.css`. No rule reordered, no byte added/removed (no section-header comments, no reformat). The cascade is then provably preserved.

## Verification (owned by main Claude)
1. **Byte-concat:** `cat dotmatrix-loader/0{1..7}-*.css` (in order) | diff against `git show HEAD:…/dotmatrix-loader.css` → EMPTY (byte-identical).
2. `pnpm --dir vex-app lint` (tsc -p + boundary) EXIT 0 — proves the 7 new CSS imports resolve.
3. Re-run the DotMatrixBase smoke test (it loads the CSS via the façade) → still passes.
4. (Optional build smoke if cheap) — confirm Vite can resolve the 7 CSS imports.
5. git scope: original `dotmatrix-loader.css` deleted + new `dotmatrix-loader/` (7 files) + façade `dotmatrix-core.tsx` (only the import lines changed); ZERO other files. Codex final → 1 commit → FF push. **Residual: manual screenshot check post-merge (no visual diff in CI).**

## Open questions for Codex
1. Are the 7 section boundaries clean (each slice = whole rules, no rule/keyframe split across files)? Any rule whose cascade position is load-bearing such that a different grouping would be safer? Cite.
2. Confirm the JS-side ordered import (not a CSS `@import` barrel) is the right call for the Tailwind v4 / @tailwindcss/vite setup, and the `../dotmatrix-loader/0X-...css` specifier depth from `components/ui/` is correct.
3. Is byte-concat-identity a sufficient cascade guard here (no `@layer` / specificity subtlety that survives byte-identity but changes with file-boundary)? 
4. Anything to serialize.
