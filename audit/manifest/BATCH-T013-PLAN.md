# Batch T-013 — telemetry-events test-split (scattered-module-scope pattern)

**Baseline:** `HEAD == origin/main == 0748b21`. Clean tree. 1 Opus agent (root vitest, fast). Proven harness; this one needs the GATHER-ALL-MODULE-SCOPE rule because helpers/mocks are interspersed between describes.

## File: `src/__tests__/vex-agent/engine/telemetry-events.test.ts` (613, 21 it, 8 vi.mock, 8 TOP-level describe, NO nested describe)
Module-scope (brace-depth-0) code is SCATTERED in 4 tiers, interspersed with the describes:
- **31-37:** top imports (vitest, node:fs, node:path, `createBandObserver` from `../../../vex-agent/engine/core/context-band.js`).
- **100-104:** `import {…} from "../../../vex-agent/engine/compact-jobs/heartbeat-rate-limit.js"` (AFTER describe #1).
- **141-270:** the big scaffold — 8 `vi.mock` blocks (141/157/175/188/201/209/222/234, all @-ALIAS module specifiers), mock spies (195-199, 233), dynamic `await import(...)` of logger (238, `@utils/logger.js` ALIAS) + 5 handlers (240/243/246/249/252, all RELATIVE `../../../vex-agent/tools/internal/...`), and `makeContext()` (255-270).
- **515-576:** naming-lint helpers — `EXCLUDED_DIR_NAMES` (515), `listRuntimeFiles()` (523), `BANNED_EVENT_PATTERNS` (558).
The 8 top describes: "createBandObserver…" (39), "shouldEmitHeartbeatFailure…" (105), "memory_recall…" (271), "mark_outstanding_resolved…" (326), "knowledge.write…" (364), "knowledge.supersede…" (406), "compact.now…" (457), "PR3-telemetry naming-consistency lint" (577).

## Split rule (GATHER-ALL-MODULE-SCOPE — robust, no tracing)
Create subdir `telemetry-events/` and DELETE the original. Each new file = **the UNION of EVERY module-scope statement** (all of tiers 31-37, 100-104, 141-270, 515-576), reproduced VERBATIM in their ORIGINAL relative order, **then** the assigned describe block(s) verbatim. Do NOT trace which describe needs which helper — copy ALL module-scope code into every file (unused `vi.mock`/helpers are harmless; vitest hoists mocks and the unused ones don't affect a describe that never imports those modules). This guarantees each file is self-contained and behavior-identical.
- `pure-units.test.ts`            ← "createBandObserver (PR3-telemetry pure unit)" + "shouldEmitHeartbeatFailure (PR3-telemetry pure unit)".
- `memory-and-outstanding.test.ts` ← "memory_recall.called + memory_recall.empty_store" + "mark_outstanding_resolved.called".
- `knowledge.test.ts`             ← "knowledge.write.with_source" + "knowledge.supersede.with_source".
- `compact.test.ts`              ← "compact.now.called + compact.now.noop rename".
- `naming-lint.test.ts`          ← "PR3-telemetry naming-consistency lint".
Keep describes in ORIGINAL relative order within a grouped file.

**Depth:** `engine/` test dir is depth-4; the subdir is depth-5 → SEVEN relative specifiers `../../../vex-agent/...` → `../../../../vex-agent/...`: line 37 (context-band), line 103 (heartbeat-rate-limit), AND the 5 handler `await import(...)` paths (memory/recall.js, memory/mark-resolved.js, knowledge/write.js, knowledge/supersede.js, compact/now.js). The `@utils/logger.js` await-import (238) and all 8 `vi.mock` specifiers are @-ALIASES (UNCHANGED). node:* unchanged. NOTE: the `import(` keyword and the relative path string are on SEPARATE lines for the 5 handler imports — recompute the string on the continuation line.

## Verification (owned by main Claude)
1. Title-set equality (HEAD vs new): 21 it (no `test()` — the earlier "1" was a regex `.test()`). Identical multiset; 8 describe titles preserved.
2. root `tsc --noEmit` EXIT 0.
3. root vitest over `telemetry-events/` → 21 passed, zero fail/skip.
4. git scope: 1 original deleted + 1 new subdir; ZERO production/other-test. Codex final → 1 commit → FF push.

## Open questions for Codex
1. Is GATHER-ALL-MODULE-SCOPE (copy every brace-depth-0 statement incl. all 8 vi.mock + the 6 top-level `await import` handler bindings + makeContext + the naming-lint helpers into EVERY file) behavior-safe, even for the pure-units + naming-lint files that don't use the db/handler mocks? Any top-level `await import` that would FAIL or mutate global state when loaded by a file whose describe never exercises it? Cite.
2. Confirm the 7 relative specifiers needing +1 (lines 37, 103, and the 5 handler await-import continuation-line strings); the @utils/logger await-import + the 8 vi.mock specifiers are aliases (unchanged).
3. Any module-scope const with ORDER dependence (e.g. a spy referenced inside a vi.mock factory) that must keep its original relative position? Confirm gathering in original order preserves it.
4. Anything to serialize.
