# Batch T5 — last vex-app IPC test-splits (T-012, T-014)

**Baseline:** `HEAD == origin/main == 8be2528`. Clean tree. 2 Opus agents parallel, file-disjoint, vex-app `node`-project IPC tests under `src/main/ipc/__tests__/`. Proven harness (T1-T4 landed green; T4 verified the vex-app recursive-glob + globals:true + +1-depth flow). Conventions identical (full preamble per file, delete original, recompute EVERY relative specifier +1 incl. dynamic await-imports and relative vi.mock, verbatim titles/bodies, aliases unchanged). Both subdirs are NEW.

## T-014 — `vex-app/src/main/ipc/__tests__/ipc-handler-surface.test.ts` (600, 34 it, 10 vi.mock, 12 TOP-level describe) — CLEAN top-level split
Preamble above first describe (176) includes the test-sender import (`./test-sender.js` → `../test-sender.js`) and 11 module-scope dynamic handler imports (lines 109-119: `../messages.js`, `../usage.js`, … → `../../*.js`). **Codex catch:** relative `vi.mock("../../database…"|"../../logger…")` paths also shift +1 → `../../../…`. Split into `__tests__/ipc-handler-surface/` (6 files), each = FULL preamble + its describe(s) verbatim:
- `messages-usage.test.ts`   ← "messages handlers" + "usage handlers".
- `compaction-knowledge-memory.test.ts` ← "compaction handler" + "knowledge handler" + "memory handlers".
- `runtime-mission.test.ts`  ← "runtime handlers" + "mission handlers".
- `approvals-wallets.test.ts` ← "approvals handlers" + "wallets-session handlers".
- `models-sessions.test.ts`  ← "models handler" + "sessions.getModel handler".
- `db-errors.test.ts`        ← "DB helper errors preserve intended VexError shape".
Keep describes in ORIGINAL relative order within a grouped file. Delete original.

## T-012 — `vex-app/src/main/ipc/__tests__/register-handler.test.ts` (681, 21 it, 3 vi.mock, 2 TOP describe) — FLAT-describe split
The file has 2 top describes: `registerHandler` (93-512, a FLAT 16-`it` block, no nested describes) and `registerHandler — cancellation (PR3)` (513-end, 5 it). Preamble above 93 includes the `load()` helper, `senderFrame`/`childSenderFrame` helpers, `trustedSender` const, AND both `beforeEach` and `afterEach` hooks (94-103) — reproduce ALL of these (incl. afterEach) in every split file.
**Codex catch — FIVE dynamic `await import("../register-handler.js")` sites, ALL → `../../register-handler.js`:** line 66 (in `load()`, reproduced in every file), 468 (inside the "logs a contract-bug warning…" it → lands in error-normalization.test.ts), and 545/602/641 (inside cancellation its → land in cancellation.test.ts). Each split file must recompute every await-import site it copies.

Split `registerHandler`'s 16 its by concern into 3 files (each reproduces preamble + `describe("registerHandler", () => {` + the describe's `beforeEach` (94+) + its subset + `})`), plus the cancellation describe as its own file → `__tests__/register-handler/` (4 files). Allocation by it-TITLE (move verbatim; the title-set guard catches any drop/dup so grouping is safe):
- `sender-and-shape.test.ts` ← "returns ok on valid input + valid output", "rejects untrusted sender with redacted error", "rejects trusted-origin subframes", "rejects invalid input shape with redacted error", "flags handlers that produce wrong-shape Result.data", "rejects error shape with unknown VexErrorCode (closed-by-convention enum)", "rejects error shape with negative retryAfterMs". (7 it)
- `error-normalization.test.ts` ← "catches handler throws and returns redacted error (does NOT leak message)", "preserves correlationId from request envelope into error response", "falls back to a generated UUID when the envelope is unparseable", "normalizes malformed handler errors to contract_violation (foreign keys stripped)", "auto-fills missing correlationId on valid handler errors", "logs structural diagnosis only on handler throw (no raw error object)", "logs a contract-bug warning when handler attaches mismatched correlationId". (7 it)
- `lifecycle.test.ts` ← "registers an idempotent unregister via globalCleanup on app quit", "globalCleanup task removes the handler on app quit (without explicit unregister)". (2 it)
- `cancellation.test.ts` ← the entire `registerHandler — cancellation (PR3)` describe (513-end, 5 it).
Total = 7+7+2+5 = 21. The 3 `registerHandler`-derived files each open `describe("registerHandler", …)` with the SAME beforeEach; the cancellation file keeps its own describe. Delete original.

## Verification (owned by main Claude)
1. Title-set equality (HEAD original vs new files): T-014=34, T-012=21. Identical multiset.
2. `pnpm --dir vex-app lint` EXIT 0.
3. vex-app vitest over the 2 subdirs → 34 + 21 = 55 passed, zero fail/skip.
4. git scope: 2 originals deleted + 2 new subdirs; ZERO production/other-test. Codex final → 2 per-item commits → FF push.

## Open questions for Codex
1. T-012 flat-describe split: confirm grouping `registerHandler`'s 16 its into 3 files (each re-opening `describe("registerHandler")` + the shared beforeEach) is behavior-safe — does any it depend on state from a sibling it within that describe (ordering), or only on the per-test beforeEach reset? Cite. Is my title→file allocation sound (esp. the error-shape-validation its)?
2. T-012: confirm BOTH dynamic `await import("../register-handler.js")` sites (module-scope load() at ~66 AND the in-test one at ~468) get +1, and `load()` is reproduced in every file.
3. T-014: any of the 12 describes share module-scope mutable beyond reset-in-beforeEach mocks? Confirm the 6 groupings + the ~10 dynamic handler-import depth (+1).
4. Anything to serialize.
