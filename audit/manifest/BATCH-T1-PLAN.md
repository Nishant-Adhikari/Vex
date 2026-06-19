# Batch T1 — test-split validating wave (T-007, T-011, T-015)

**Baseline:** `HEAD == origin/main == 43d7ae9`. Clean tree. 3 Opus agents parallel, file-disjoint, all ROOT vitest tests under `src/__tests__/vex-agent/tools/`. This is the FIRST test-split wave — validates the harness before the bigger (T-001..T-004, 1000-1447 LOC) and vex-app (T-005/006/009/012/014) waves.

**Goal:** split each large `*.test.ts` into a sibling subdir of per-area `*.test.ts` files so no single test requires reading unrelated scenario setup — WITHOUT changing any test's behavior, assertions, or titles, and WITHOUT touching any production file. Production code is UNTOUCHED (these production modules were already split in earlier batches); a test-split only reorganizes test cases.

## Convention (test-split flavor of B-000)
- Nothing imports a `*.test.ts`, so there is NO façade. Instead: create a sibling subdir named after the file (minus `.test.ts`), move each top-level `describe` block VERBATIM into a per-area `*.test.ts` file there, then DELETE the original file. vitest auto-discovers the new files (`include: src/__tests__/**/*.test.ts`).
- **Mock preamble (hoisting-safe rule):** vitest hoists `vi.mock` per-file; sharing mock spies across files via imports hits the TDZ/hoisting trap. So EACH area file reproduces the ORIGINAL top-of-file preamble (everything above the first `describe`) **VERBATIM** — the vitest imports, every module-scoped spy `const` (the `vi.fn()`s), every `vi.mock(...)` block, and the module-under-test imports. Do NOT trace which subset of mocks a describe uses; copy them all (unused mocks are harmless, beforeEach resets them). This guarantees each file's mock environment is byte-identical to the original.
- **Pure shared helpers (optional):** genuinely hoisting-safe, pure items (a `ctx()` factory with no `vi.fn` at module-init, plain data constants, pure fixture builders) MAY move to a co-located `_shared.ts` (NOT matched by the test glob) and be imported. If in doubt, DUPLICATE rather than share — correctness over DRY. `_shared.ts` must contain NO `vi.mock`/`vi.fn` at module scope.
- **Relative-import depth:** moving into a `+1`-deep subdir shifts every RELATIVE specifier by one `../`. Recompute the module-under-test imports and any relative `vi.mock` paths. Path aliases (`@vex-agent`, `@tools`, `@utils`, `@config`) are UNCHANGED.
- **Verbatim test bodies:** every `describe`/`it`/`test` title and body moves byte-identical. Do NOT rename, merge, reword, add, or drop a single test. `beforeEach`/`afterEach`/helpers that a describe block uses travel with it (or are duplicated into each file that needs them).

## T-007 — `src/__tests__/vex-agent/tools/kyberswap-handlers.test.ts` (841, 6 vi.mock, 41 it, 4 describe)
Pair: A-030/A-031 (done). Preamble = lines 1-126 (spies + 6 `vi.mock`: resolve, zaas/client, evm-utils, token-api/client, aggregator/client, logger; + `ctx()` helper; + imports of `KYBERSWAP_HANDLERS`, `KYBERSWAP_TOOLS` at `../../../vex-agent/...` → recompute to `../../../../vex-agent/...`).
Split into `kyberswap-handlers/`:
- `registry-validation.test.ts` ← describe "kyberswap handlers" (127-466, 27 it: registry parity + per-tool param-fail + zap capture).
- `wallet-resolution.test.ts` ← describe "kyberswap session wallet resolution" (467-519, 2 it).
- `quote-safety.test.ts` ← describe "kyberswap.swap.quote token safety (Stage 6b)" (520-723, 7 it).
- `execute-safety-gate.test.ts` ← describe "executeKyberSwap inline safety gate (FIX 1, broadcast path)" (724-841, 5 it).
Delete the original. (Keeping describe "kyberswap handlers" whole is fine; do not subdivide unless trivially clean.)

## T-011 — `src/__tests__/vex-agent/tools/protocols/bridge-prequote.test.ts` (683, 3 vi.mock, 36 it, 6 describe)
Pair: A-001 (done). Preamble = lines 1-178 (3 `vi.mock`: swap-prequotes repo, wallet/resolve, khalani/chains; + helpers; aliases `@vex-agent`/`@tools` UNCHANGED). **Codex catch: line 37 `import { VexError, ErrorCodes } from "../../../../errors.js"` → recompute to `../../../../../errors.js` (+1 depth) in every area file.**
Split into `bridge-prequote/`:
- `identity-hash.test.ts` ← "computePrequoteMatchHash — bridge identity" (179-296).
- `build-identity.test.ts` ← "buildBridgeIdentity — defaults" (297-376).
- `record.test.ts` ← "recordPrequoteFromQuote — bridge" (377-445).
- `gate.test.ts` ← "evaluatePrequoteGate — bridge" (446-513) + "evaluatePrequoteGate — bridge unbindable execute-only params" (514-552). (Both gate describes together.)
- `collision.test.ts` ← "bridge quote ↔ execute identity collision" (553-end).
Delete the original.

## T-015 — `src/__tests__/vex-agent/tools/internal/wallet/send.test.ts` (588, 5 vi.mock, 22 it, 4 describe)
Pair: A-024 (done). Preamble = lines 1-152 (5 `vi.mock`: wallet-intents repo, send-execute-solana, send-execute-evm, wallet/resolve, logger; note the 4 RELATIVE `vi.mock` paths `../../../../../vex-agent/...` → recompute to `../../../../../../vex-agent/...`).
Split into `send/`:
- `prepare.test.ts` ← "handleWalletSendPrepare" (153-233).
- `confirm-preconditions.test.ts` ← "handleWalletSendConfirm — preconditions" (234-327).
- `confirm-routing.test.ts` ← "handleWalletSendConfirm — ExecuteOutcome routing" (328-554).
- `confirm-redaction.test.ts` ← "handleWalletSendConfirm — secret redaction" (555-end).
Delete the original.

## Verification (owned by main Claude — the authoritative guard)
1. **Title-set equality:** extract the sorted set of all `it(`/`test(` titles from each ORIGINAL file at HEAD; extract from the new subdir files; assert the multiset is IDENTICAL (same titles, same count — T-007:41, T-011:36, T-015:22). Also assert every `describe` title is preserved.
2. **All green + count parity:** root `pnpm exec vitest run --no-file-parallelism src/__tests__/vex-agent/tools/kyberswap-handlers/ src/__tests__/vex-agent/tools/protocols/bridge-prequote/ src/__tests__/vex-agent/tools/internal/wallet/send/` → total passing == 41+36+22 = 99, zero failures.
3. **root `tsc --noEmit`** EXIT 0 (the `_shared.ts` files + recomputed imports typecheck).
4. **git scope:** only the 3 original test files DELETED + 3 new subdirs of test files (+ optional `_shared.ts`); ZERO production files, ZERO other test files. Codex final → 3 per-item commits (path-scoped) → FF push.

## Open questions for Codex
1. Is the "duplicate the FULL preamble (spies + every `vi.mock`) verbatim per area file, share only pure helpers via `_shared.ts`" rule the right hoisting-safe call, or do you prefer a `vi.hoisted()`-based shared factory? Cite the TDZ risk if relevant. For T-007/T-011/T-015 specifically, are there any module-scoped helpers that are NOT hoisting-safe to share (so they must be duplicated)?
2. For each file, are the proposed describe-to-file groupings clean (each describe self-contained, no cross-describe shared mutable state beyond the reset-in-beforeEach spies)? Any describe that shares a `let`/closure with another and must stay together? Cite lines.
3. Confirm deleting the original `*.test.ts` (no façade for tests) is correct and that vitest's `include` glob discovers the new subdir files.
4. Any per-file relative-import depth I mis-stated (esp. T-015's `../../../../../vex-agent/...` and T-007's `../../../vex-agent/...`)? Anything to serialize?
