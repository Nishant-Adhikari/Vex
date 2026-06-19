# Batch P0-A — Agent-runtime god-file splits (A-001…A-004)

**Mode:** development (no installed users, no data-compat burden). Aggressive refactor allowed; core invariants non-negotiable.
**Baseline:** `HEAD == origin/main == d0977c9`, working tree clean (only `audit/`, screenshots, `memory-system.md` untracked).
**Execution:** 4 Opus-4.8 subagents in parallel, one per item, **file-disjoint**. Façade-preserving structural splits only — **no behavior change intended**. Paired B-items (B-001/B-002/B-003) already landed; these are now PURE structural cuts that must preserve those invariants verbatim.

## Why these four, why now, why parallel-safe

Each target becomes a **compatibility façade** at its current path re-exporting the *identical* public surface (values, functions, types, interfaces, and re-exports). Because of that, the cross-imports between the four resolve through façades and **no agent edits another agent's file**:

| Imports… | …from | resolves via |
|---|---|---|
| A-003 `runtime` → `evaluatePrequoteGate`, `recordPrequoteFromQuote`, `EXECUTE_GATE_TOOLS` | A-001 `swap-prequote` | A-001 façade |
| A-002 `dispatcher` → `executeProtocolTool` | A-003 `runtime` | A-003 façade |
| A-004 `post-tx` → `dispatchTool`, `dispatchTargetIsMutating` | A-002 `dispatcher` | A-002 façade |

New module subdirs are distinct: `protocols/prequote/`, `protocols/runtime/`, `tools/dispatcher/`, `engine/core/approval-runtime/post-tx/`. **No importer files are modified** (B-000 §2: do not change caller imports in the same change as the split). **Big test files are NOT split** here (that is the separate P3 batch T-001…T-015); existing tests must stay green through the façade.

## B-000 obligations (apply to every item)

1. **Pin behavior:** existing suites are thick — they ARE the characterization layer. They must pass unchanged through the façade.
2. **Façade + surface assertion:** keep the original path exporting identical symbols; add one tiny `*-surface.test.ts` that imports the façade and asserts each expected export is defined / of the right typeof. Do not change caller imports.
3. **Boundary/invariant guards stay green:** the named invariant test(s) per item below must pass after the split.
4. **No new behavior, no signature changes, no error-string changes.** Move code; do not "improve" it.

---

### A-001 — `src/vex-agent/tools/protocols/swap-prequote.ts` (1316 LOC)

**Façade exports to preserve (exact):** `PREQUOTE_QUOTE_TOOLS`, `PREQUOTE_MAX_AGE_MS`, `SwapMatchInput`, `BridgeMatchInput`, `PrequoteMatchInput`, `BridgeTradeType`, `computePrequoteMatchHash`, `buildBridgeIdentity`, `extractQuote`, `recordPrequoteFromQuote`, `ExecuteGateRegistration`, `EXECUTE_GATE_TOOLS`, `GateDecision`, `evaluatePrequoteGate`, `evaluateSwapPrequoteGate`.

**Proposed modules:** `protocols/prequote/registry.ts` (`PREQUOTE_QUOTE_TOOLS`, `EXECUTE_GATE_TOOLS`, `PREQUOTE_MAX_AGE_MS`, registration types) · `prequote/identity/hash.ts` (`SwapMatchInput`/`BridgeMatchInput`/`PrequoteMatchInput`/`BridgeTradeType`, `computePrequoteMatchHash`) · `prequote/identity/bridge.ts` (`buildBridgeIdentity` + defaults) · `prequote/safety/extract.ts` (`extractQuote` + EVM/Solana verdict schemas) · `prequote/record.ts` (`recordPrequoteFromQuote`) · `prequote/gate.ts` (`GateDecision`, `evaluatePrequoteGate`, `evaluateSwapPrequoteGate`, block messages).

**Non-test importers (must keep compiling, untouched):** `db/repos/swap-prequotes.ts`, `engine/core/approval-intent-preview.ts`, `tools/types.ts`, `protocols/runtime.ts`.
**Invariant guards (stay green):** `swap-prequote.test.ts`, `bridge-prequote.test.ts`, `runtime-prequote-gate.test.ts`, `dispatcher-swap-alias-gate.test.ts`, `db/repos/swap-prequotes.test.ts`.
**Invariant:** stale / missing / mismatched quote → **fail closed**; deterministic hash goldens unchanged.

---

### A-002 — `src/vex-agent/tools/dispatcher.ts` (478 LOC)

**Façade exports to preserve (exact):** `checkPressureDeny`, `checkPlanAcceptanceDeny`, `dispatchTool`, `dispatchTargetIsMutating`, `INTERNAL_TOOL_LOADERS`.

**Proposed modules:** `tools/dispatcher/pressure-gate.ts` (`checkPressureDeny`) · `dispatcher/plan-acceptance-gate.ts` (`checkPlanAcceptanceDeny`) · `dispatcher/mutating-targets.ts` (`dispatchTargetIsMutating` + alias/target classification) · `dispatcher/internal-loaders.ts` (`INTERNAL_TOOL_LOADERS`) · `dispatcher/protocol-route.ts` (protocol/direct route selection). Keep `dispatchTool` orchestrator in the façade.

**Non-test importers (untouched):** `engine/core/run-tool.ts`, `engine/core/turn-loop-tool-batch.ts`, `engine/core/approval-runtime/post-tx.ts`, `tools/registry/subagents.ts`.
**Invariant guards (stay green):** `dispatcher-pressure-deny.test.ts`, `dispatcher-plan-deny.test.ts`, `dispatcher-protocol.test.ts`, `dispatcher-swap-alias.test.ts`, `dispatcher-misc.test.ts`, `run-tool.test.ts`, `approval-runtime.test.ts`.
**Invariant:** mutating classification unchanged; approved post-tx dispatch flows through the same boundary; unauthorized direct calls stay denied; gate **ordering** (pressure → plan-acceptance → route) unchanged.

---

### A-003 — `src/vex-agent/tools/protocols/runtime.ts` (631 LOC — grew from 415 via B-002/B-003)

**Façade exports to preserve (exact):** `executeProtocolTool` **and** the re-export `export { discoverProtocolCapabilities } from "./discovery.js"`.

**Proposed modules:** `protocols/runtime/params.ts` (strict **Zod** boundary validation — preserve B-002 exactly, incl. rejection of unknown/nested keys and the `dryRun` runtime-reserved control key) · `runtime/gates.ts` (prequote gate + approval gate invocation) · `runtime/capture.ts` (capture validation/projection/audit) · `runtime/errors.ts` (provider-safe normalization/redaction — preserve B-003 `summarizeProtocolError`/`classifyError` + canonical `redact()` exactly) · `runtime/execute.ts` (handler-execution orchestration). Keep `executeProtocolTool` + discovery re-export in the façade.

**Non-test importers (untouched):** `engine/types.ts`, `tools/dispatcher.ts`, `tools/internal/action-aliases.ts`, `tools/internal/khalani.ts`, `tools/protocols/types.ts`, `tools/registry/protocol.ts`.
**Invariant guards (stay green):** `runtime-type-validation.test.ts`, `runtime-error-redaction.test.ts`, `runtime-prequote-gate.test.ts`, `protocol-discovery.test.ts`, `protocol-wallet-scope.test.ts`, `action-aliases.test.ts`, `sync/runtime-capture.test.ts`.
**Invariant:** handler NOT invoked on invalid params / denied approval / denied prequote / invalid capture; all error strings + logs redacted (no key/bearer/URL/body).

---

### A-004 — `src/vex-agent/engine/core/approval-runtime/post-tx.ts` (502 LOC — grew from 428 via B-001)

**Façade exports to preserve (exact):** `applyApproveSideEffects`, `applyRejectSideEffects`, `applyPolicyDriftSideEffects`.

**Proposed modules:** `approval-runtime/post-tx/policy-recheck.ts` (approve-time live-policy recheck — preserve B-001 fail-closed-before-dispatch exactly; `applyPolicyDriftSideEffects` NEVER dispatches) · `post-tx/dispatch-approved.ts` (approved tool dispatch context + wallet hydration) · `post-tx/result-message.ts` (append tool result + execution-status mapping) · `post-tx/reject.ts` (`applyRejectSideEffects`) · `post-tx/recovery.ts` (paused-error / continuation recovery). Keep the three `apply*` entrypoints in the façade.

**Non-test importer (untouched):** `engine/core/approval-runtime.ts`.
**Invariant guards (stay green):** `approval-runtime.test.ts`, `reject.test.ts`, `resume.test.ts`.
**Invariant:** approve-time policy drift fails closed **before** any dispatch/state transition; continuation claim behavior intact; no double-dispatch.

---

## Verification protocol (owned by main Claude, after all 4 agents finish)

1. Integrated typecheck: `pnpm tsc --noEmit` at repo root (single process; transient mid-parallel errors don't count — only the final integrated state).
2. `pnpm --dir vex-app lint` (project-wide tsc) if any vex-app file touched (none expected here — all four targets are under `src/`).
3. Single-process affected vitest (NOT the full suite, NOT parallel) over the union of the invariant-guard suites above plus each `*-surface.test.ts`.
4. `git status` scope check: only the four target files modified + the four new subdirs + four surface tests created; **zero** importer files changed; `audit/`, screenshots, `memory-system.md` remain untracked.
5. Codex final-review gate before any commit. Commit only on explicit user request, per-concern staging, FF push `HEAD:main` after `origin/main == HEAD`.

## Open questions for Codex (plan-review gate)

1. Is the proposed seam for each file correct, and is there any **hidden coupling** (shared private helper, module-load side effect, circular import) that would break file-disjointness or force editing an importer?
2. For A-003, splitting params/gates/capture/errors/execute out of `runtime.ts`: any ordering or shared-closure hazard that could subtly change the B-002 validation or B-003 redaction behavior?
3. For A-004, is `policy-recheck` cleanly separable from `dispatch-approved` without risking the B-001 "fail-closed before dispatch" ordering?
4. Any item that should NOT be in this parallel wave (e.g. better serialized), or any additional invariant guard test I should pin before cutting?
