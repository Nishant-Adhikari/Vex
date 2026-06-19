# Batch T3 — turn-loop test-split (T-002)  [T-013 DEFERRED]

**Baseline:** `HEAD == origin/main == 9e61147`. Clean tree. 1 Opus agent, ROOT vitest. Same proven harness (T1/T2 landed green: 99 + 120 tests, title-sets identical, zero production touched). Conventions identical — see BATCH-T1/T2-PLAN.md (full preamble per file, delete original, recompute relative depths +1, verbatim titles/bodies).

**T-013 DEFERRED** (Codex catch): telemetry-events.test.ts has module-level mocks/helpers SCATTERED through the file (≈100-103, 141-269, 515-575), not a clean 1-38 preamble, and no `test(` (the "1" was a regex `.test()`); it needs a careful structure map — handle in its own wave.

## T-002 — `src/__tests__/vex-agent/engine/core/turn-loop.test.ts` (1311, SINGLE top describe("turn-loop") + 1 outer `it` + 10 nested, 34 it total, 15 vi.mock) — NESTED split (like T-010)
Preamble (above the top describe) = lines 1-207. The outer `describe("turn-loop")` opens at 208 and contains, BEFORE the nested describes:
- `beforeEach` at **209-220** (shared setup: mocks defaulted),
- an **OUTER-LEVEL `it`** at **227-234** ("does not call runPromotionForSession…", a source-lint regression — 1 of the 34 tests; uses NO helpers),
- shared helper fns + const at **236-303**: `makeContext`, `makeProvider`, `makeStreamingProvider`, `makeConfig`, `defaultLoopConfig`.
Then 10 nested describes: chat mode (307), mission mode (390), approval pause (467), iteration limit (596), deferred save (615), batch approval (674), batch engine signal (787), wait_for_parent signal (865), pressure gating (890-1282), complete_subagent signal (1283-end).

**Codex catch:** the SHARED setup duplicated into every file is the `beforeEach` (209-220) + the helpers (236-303) — NOT the outer `it` (227-234). The outer `it` must appear in EXACTLY ONE file.

**Each file reproduces:** preamble (1-207, depths +1) VERBATIM + `describe("turn-loop", () => {` + `beforeEach` (209-220) + the helpers/const (236-303) VERBATIM + its assigned content + closing `});`. Split into `turn-loop/` (7 files):
- `promotion-regression.test.ts` ← the OUTER `it` (227-234) ONLY (no nested describe). This is where the single outer test lives.
- `chat-mode.test.ts`        ← nested "chat mode".
- `mission-mode.test.ts`     ← nested "mission mode".
- `approval-and-batch.test.ts` ← "approval pause" + "batch approval" + "batch engine signal" (original relative order).
- `iteration-and-save.test.ts` ← "iteration limit" + "deferred save".
- `pressure-gating.test.ts`  ← "pressure gating".
- `subagent-signals.test.ts` ← "wait_for_parent signal" + "complete_subagent signal".
Total `it`: 1 (outer) + 33 (nested across the 6 group files) = 34. Delete original. (engine/core test dir depth-5 → subdir depth-6: every relative `../../../../vex-agent/...` → `../../../../../vex-agent/...`, incl. the `runTurnLoop` dynamic import; aliases unchanged.)

## Verification (owned by main Claude)
1. Title-set equality (HEAD original vs new files): count T-002=34 (1 outer `it` + 33 nested). Identical multiset. (Guard against the outer `it` being duplicated or dropped.)
2. root `tsc --noEmit` EXIT 0.
3. root vitest over `turn-loop/` → 34 passed, zero fail/skip. (Subdir is new — no pre-existing files.)
4. git scope: 1 original deleted + 1 new subdir (7 files); ZERO production/other-test. Codex final → 1 commit → FF push.

## Open questions for Codex
1. T-002 nested-split: confirm reproducing `describe("turn-loop")` + the outer beforeEach (209-306) per file is correct, and no nested describe declares its own `let`/closure shared with a sibling (cite). Are the 6 groupings sound, or should any nested describe move groups (esp. is "pressure gating" self-contained)?
2. T-013: do any of the 8 top describes share module-scope mutable beyond reset-in-beforeEach mocks? Confirm the 5 groupings + the `test(` (1) move cleanly.
3. Relative-import depths: confirm T-002 (depth-5→6) and T-013 (depth-4→5) recompute factors and any specific specifier I should flag.
4. Any pre-existing co-located files already in `turn-loop/` or `telemetry-events/` subdirs I should expect? Anything to serialize?
