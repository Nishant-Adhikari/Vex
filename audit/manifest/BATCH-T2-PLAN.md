# Batch T2 — root engine/protocol test-splits (T-003, T-008, T-010)

**Baseline:** `HEAD == origin/main == 1c0b3e2`. Clean tree. 3 Opus agents parallel, file-disjoint, all ROOT vitest tests. Same proven T1 harness (delete original, per-area subdir, full-preamble-per-file verbatim, recompute relative depths, ZERO behavior/title change, ZERO production touched). T1 validated the pattern (99 tests, title-sets identical). This wave adds the NESTED-describe split pattern (T-010).

## Convention (same as T1 — see BATCH-T1-PLAN.md)
Each area file reproduces the ORIGINAL top-of-file preamble (everything above the first top-level `describe`) VERBATIM — vitest imports, every module-scoped `vi.fn` spy, every `vi.mock` block, module-under-test imports — then holds its assigned describe block(s) verbatim. Pure hoisting-safe helpers MAY go to `_shared.ts` (no `vi.mock`/`vi.fn`); if in doubt, duplicate. Recompute every RELATIVE specifier (+1 `../`); aliases unchanged. Delete the original. No test added/dropped/reworded; every `it`/`describe` title byte-identical.

## T-003 — `src/__tests__/vex-agent/tools/protocols/swap-prequote.test.ts` (1012, 5 top-describe, 62 it, 3 vi.mock) — CLEAN top-level split
Pair A-001 (done). Preamble = lines 1-166. Split into `swap-prequote/`:
- `verdict-evm.test.ts`  ← "verdict — EVM (kyberswap.swap.quote)" (167-283).
- `verdict-solana.test.ts` ← "verdict — Solana (solana.swap.quote)" (284-359).
- `match-hash.test.ts`   ← "computePrequoteMatchHash" (360-496).
- `record.test.ts`       ← "recordPrequoteFromQuote" (497-632).
- `gate.test.ts`         ← "evaluateSwapPrequoteGate" (633-end). **Gate tests prove fail-closed — keep verbatim.**
Delete original. Recompute any relative imports (+1).

## T-008 — `src/__tests__/vex-agent/engine/core/approval-runtime.test.ts` (1013, 4 top-describe, 32 it, 13 vi.mock) — SECURITY, clean top-level split
Pair A-004/A-017/B-001 (done). Preamble = lines 1-312 (13 `vi.mock` — large; reproduce verbatim per file). Split into `approval-runtime/`:
- `prepare-approve.test.ts` ← "prepareApprove" (313-780) — INCLUDES the NESTED describe "B-001 policy-drift re-enforcement" (614-780) which stays INSIDE prepareApprove's file verbatim. Biggest file.
- `prepare-reject.test.ts`  ← "prepareReject" (781-904).
- `expire-approval.test.ts` ← "expireApproval" (905-936).
- `sweep-expired.test.ts`   ← "sweepExpiredApprovals" (937-end).
Delete original. **B-001 fail-closed/policy-drift assertions move byte-identical; do not weaken.** Recompute relative imports (+1).

## T-010 — `src/__tests__/vex-agent/engine/core/runner.test.ts` (821, SINGLE top-describe + 4 nested, 26 it, 18 vi.mock) — NESTED split pattern
Pair turn-loop/runner (done). Preamble = lines 1-247 (18 `vi.mock` — large). The file has ONE top-level `describe("runner", () => {` at 248. Lines ~249-288 are OUTER-DESCRIBE-LEVEL setup (shared `beforeEach`/helpers INSIDE `describe("runner")`, before the first nested describe at 289). Split by the 4 NESTED describes into `runner/`:
- `process-agent-turn.test.ts`        ← runner > "processAgentTurn" (289-353).
- `process-mission-setup-turn.test.ts` ← runner > "processMissionSetupTurn" (354-443).
- `start-mission.test.ts`             ← runner > "startMission" (444-761) — biggest, ~16 it.
- `resume-mission-run.test.ts`        ← runner > "resumeMissionRun" (762-end).
**Each file must reproduce: the preamble (1-247) VERBATIM, then `describe("runner", () => {` + the OUTER-LEVEL setup (the beforeEach/helpers in ~249-288) VERBATIM + its ONE assigned nested describe verbatim + the closing `});`.** The `describe("runner")` wrapper title is duplicated across files (vitest allows the same describe name in separate files). Delete original. Recompute relative imports (+1).

## Codex-confirmed relative-depth catches (recompute these exactly)
- **T-003 swap-prequote:** `../../../../errors.js` → `../../../../../errors.js` (+1).
- **T-008 approval-runtime:** the runner mission mock specifier → `../../../../../vex-agent/engine/core/runner/mission.js` (+1); recompute any other relative `../../../../vex-agent/...` too.
- **T-010 runner:** EVERY `../../../../vex-agent/...` specifier → `../../../../../vex-agent/...` (+1), INCLUDING the inner `release-and-emit` imports. Aliases unchanged.
- T-010 outer shared setup is lines **248-285** (the `describe("runner")` + outer `beforeEach`); 287-288 is just the `processAgentTurn` separator comment.

## Verification (owned by main Claude)
1. Title-set equality (HEAD original vs new files): identical multiset of `it`/`test` titles; counts T-003=62, T-008=32, T-010=26.
2. root `tsc --noEmit` EXIT 0.
3. root vitest over the 3 subdirs → 62+32+26 = 120 passed, zero fail/skip.
4. git scope: 3 originals deleted + 3 new subdirs; ZERO production/other-test files. Codex final → 3 per-item commits → FF push.

## Open questions for Codex
1. T-010 (and the deferred T-002): confirm the nested-split rule — reproduce `describe("runner")` + its outer-level `beforeEach`/setup (lines ~249-288) in EACH file, then one nested describe. Is there outer-level mutable state in 249-288 that any nested describe mutates in a way that breaks when separated (beyond reset-in-beforeEach)? Cite lines.
2. T-008: confirm the nested "B-001 policy-drift re-enforcement" describe belongs entirely inside prepareApprove's file (it tests prepareApprove drift), and the 4-way top-level split keeps every fail-closed assertion intact. Any cross-describe shared `let`? Cite.
3. T-003: any of the 5 top describes share a module-scope mutable beyond the reset-in-beforeEach mocks? Confirm 3-mock preamble is fully hoisting-safe to duplicate.
4. Per-file relative-import depths I should double-check (engine/core is depth-5: `src/__tests__/vex-agent/engine/core/` → subdir is depth-6)? Anything to serialize?
