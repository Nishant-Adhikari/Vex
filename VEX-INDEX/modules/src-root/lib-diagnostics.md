---
id: module.src-root.lib-diagnostics
kind: module
paths:
  - "src/lib/diagnostics/text-redaction.ts"
  - "src/lib/diagnostics/redactor.ts"
  - "src/lib/diagnostics/bug-report-sink.ts"
  - "src/lib/diagnostics/bug-report-schema.ts"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/lib/diagnostics/**"
  - "src/vex-agent/engine/types.ts"
  - "src/vex-agent/memory/redaction.ts"
  - "src/__tests__/lib/diagnostics/**"
related:
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.data-memory-knowledge
---

# src/lib/diagnostics — Shared Redaction + Bug-Report Contracts

## Purpose

A pure, cross-process library (no Electron, no React, no DB, no I/O) that
provides (1) two-tier text/object redaction for memory writes and diagnostic
payloads, (2) the injectable `BugReportSink` interface and no-op default plus
`emitBugReportSafe` fail-closed wrapper, and (3) the canonical Zod schemas
and TypeScript types for the bug-report IPC boundary. All four files are the
single source of truth imported by `src/vex-agent`, `vex-app/src/main`,
`vex-app/src/shared`, and `vex-app/src/preload` — preventing any duplication
of redaction logic or schema shape across process boundaries.

## Retrieval keywords

- text-redaction, redact, redactObject, RedactionResult
- two-tier redaction, Tier 1 hard redact, Tier 2 mask
- BIP39 mnemonic, private key, API key, JWT redaction
- EVM address mask, Solana address mask, tx hash mask
- redactBugPayload, redactDeep, DiagnosticRedactionResult
- key-name redaction, SENSITIVE_KEY_RE, depth limit, cycle guard, bigint normalization
- BugReportSink, noopBugReportSink, emitBugReportSafe, AgentBugReportInput
- bug-report-schema, createBugReportInputSchema, bugReportCategorySchema
- runtimeStatusSchema, RuntimeStatus, MISSION_RUN_STATUSES mirror, drift test
- AgentBugReportContext, agentBugReportContextSchema
- SUPPORT_CATEGORY_REGEX, KNOWN_AUTOMATIC_CATEGORIES, MANUAL_CATEGORIES

## State owned

- No DB tables, no env vars, no Zustand stores.
- **In-process module state**: none — all four files are stateless pure modules
  (the sink registry in `bug-report-registry.ts` under
  `src/vex-agent/engine/support/` is a separate Z1 file; it imports this module
  but owns the mutable `currentSink` variable itself).

## Boundary crossings

- **None** from within this module. It contains only pure functions, interface
  definitions, and Zod schemas. No network, no DB, no filesystem, no IPC.
- Consumers cross process and zone boundaries by importing these symbols:
  - Z4 memory layer (`vex-agent/memory/redaction.ts`) → `text-redaction.ts`
  - Z1 engine emit sites (via dynamic import) → `bug-report-sink.ts`
  - Z6 main process service → `redactor.ts` via `@vex-lib/diagnostics/redactor.js`
  - Z7 shared schemas → `bug-report-schema.ts` via `@vex-lib/diagnostics/bug-report-schema.js`
  - Z7 preload bridge → `bug-report-schema.ts` via `@shared/schemas/bug-reports.js`

## File map

- `src/lib/diagnostics/text-redaction.ts:86 redact` — two-tier text string
  redactor; Tier 1 replaces secrets with `[REDACTED:<class>]`, Tier 2 masks
  addresses/hashes. Returns `RedactionResult { text, hardRedactCount, maskCount }`.
- `src/lib/diagnostics/text-redaction.ts:166 redactObject` — shallow per-field
  wrapper; applies `redact` to string fields and string array elements; passes
  through non-string values unchanged. Returns same counts shape.
- `src/lib/diagnostics/redactor.ts:122 redactBugPayload` — deep recursive
  diagnostic redactor (depth cap 8, WeakSet cycle guard, bigint normalization,
  per-string 4000-char cap). Layer 1: key-name match (`SENSITIVE_KEY_RE`);
  Layer 2: text-redaction on every string leaf. Returns
  `DiagnosticRedactionResult<T> { value, hardRedactCount, maskCount }`.
- `src/lib/diagnostics/bug-report-sink.ts:51 noopBugReportSink` — default
  no-op `BugReportSink`; engine stays inert until vex-app mounts the real sink.
- `src/lib/diagnostics/bug-report-sink.ts:65 emitBugReportSafe` — fail-closed
  wrapper; catches any sink throw, logs at `warn` with category/severity/error,
  returns `void` — never propagates back into the engine runtime path.
- `src/lib/diagnostics/bug-report-schema.ts:105 runtimeStatusSchema` — local
  mirror of `MISSION_RUN_STATUSES`; drift test pins both (see drift test below).
- `src/lib/diagnostics/bug-report-schema.ts:139 createBugReportInputSchema` —
  full `CreateBugReportInput` Zod schema (strict, with defaults). IPC boundary
  gate for both user-initiated and automatic reports.

## Key types & invariants

### Two-tier redaction (text-redaction.ts)

**Tier 1 — HARD REDACT** (`[REDACTED:<class>]`): replaces in order —

| Pattern | Symbol | file:line |
|---------|--------|-----------|
| Labelled EVM private key (`private_key: 0x…` / `seed_key: 0x…` etc.) | `PRIVATE_KEY_LABELLED_RE` | `text-redaction.ts:48` |
| Raw 64-hex after key label (no `0x`) | `RAW_HEX_KEY_RE` | `text-redaction.ts:51` |
| Known API key prefixes (`sk-`, `sk_live_`, `sk-or-`, `sk-ant-`, etc.) | `API_KEY_PREFIX_RE` | `text-redaction.ts:54` |
| JWT (`eyJ…` three base64url segments) | `JWT_RE` | `text-redaction.ts:57` |
| BIP39 heuristic (12–24 lowercase 3–8-char words, no sentence punctuation) | `BIP39_HEURISTIC_RE` | `text-redaction.ts:63` |

**Tier 2 — MASK** (shape-preserving `0xabcd…1234` / `Abc…1234`): applied
after Tier 1 so already-redacted placeholders are skipped —

| Pattern | Symbol | file:line |
|---------|--------|-----------|
| Transaction hash (`0x` + 64 hex) — processed first, longer wins | `TX_HASH_HEX_RE` | `text-redaction.ts:73` |
| EVM address (`0x` + 40 hex) | `EVM_ADDRESS_RE` | `text-redaction.ts:68` |
| Solana address (base58, 32–44 chars, excludes `0OIl`) | `SOLANA_ADDRESS_RE` | `text-redaction.ts:78` |

Order invariant: Tier 1 runs before Tier 2 so labelled private keys (which
are also 64-hex) are hard-redacted and not merely masked as tx hashes.
Within Tier 2, tx hash (64 hex) is matched before EVM address (40 hex)
to prevent a 64-hex string matching the shorter 40-hex pattern first.

- `RedactionResult` (`text-redaction.ts:34`) — `{ text: string; hardRedactCount: number; maskCount: number }`; both counts are additive across all patterns; zero counts on empty input.
- `redactObject` is **shallow**: arrays of objects are passed through without recursing into them. Callers needing deep structural redaction must use `redactBugPayload` from `redactor.ts`.

### Composite redactor (redactor.ts)

- `SENSITIVE_KEY_RE` (`redactor.ts:27`) — key-name pattern: `password|passphrase|mnemonic|seed|phrase|private_key|secret|token|api_key|auth|signature|sig|wallet|address|keystore|cipher|tag|salt|nonce|iv|jwt`. A matching key name causes the **value** to be replaced with `"[REDACTED]"` unconditionally (regardless of value content), and `hardRedactCount` is incremented by 1.
- **Depth cap** (`redactor.ts:54`) — `depth > 8` returns `"[depth-limit]"`. Prevents stack overflow on deeply nested diagnostic objects.
- **Cycle guard** (`redactor.ts:51`) — `WeakSet<object>` tracks seen arrays and plain objects; circular reference returns `"[circular]"`.
- **bigint normalization** (`redactor.ts:75`) — `bigint` values are coerced to decimal strings via `.toString()`. Required because `JSON.stringify(1n)` throws; the DB layer serializes sanitized context to JSON before INSERT, so un-normalized bigints would surface as `support.persist_failed`. This is a correctness invariant, not merely a convenience.
- **Error unwrapping** (`redactor.ts:81`) — `Error` instances are explicitly handled BEFORE the `isPlainObject` branch: `Object.entries(err)` only sees own enumerable properties and misses `name`, `message`, and `stack` where secrets commonly appear. The explicit branch extracts those three fields and redacts each string.
- **Per-string size cap** (`redactor.ts:63`) — strings longer than 4000 chars are truncated with `…[truncated N chars]` suffix after text-redaction runs.
- `DiagnosticRedactionResult<T>` (`redactor.ts:33`) — `{ readonly value: T; readonly hardRedactCount: number; readonly maskCount: number }`. Counts are aggregate across the full tree.

### Bug-report sink (bug-report-sink.ts)

- `BugReportSink` (`bug-report-sink.ts:42`) — `{ emit(input: AgentBugReportInput): Promise<void> }`.
- `AgentBugReportInput` (`bug-report-sink.ts:31`) — reduced `CreateBugReportInput` constrained to `source: "agent" | "worker"`, always carries `agentContext`. `reportKind` is implicitly `"automatic"`.
- `emitBugReportSafe` invariant: **never throws**. All engine emit points MUST call through this helper (not `sink.emit` directly) so a sink outage cannot alter runtime path or fail a chat turn.

### Bug-report schema (bug-report-schema.ts)

- `runtimeStatusSchema` (`bug-report-schema.ts:105`) — local `z.enum` mirror of `MISSION_RUN_STATUSES` from `src/vex-agent/engine/types.ts`. The two MUST remain in sync; CI drift test at `src/__tests__/lib/diagnostics/runtime-status-sync.test.ts` pins them via `runtimeStatusSchema.options` (Zod public API, not `_def.values`). Current values: `running | paused_approval | paused_wake | paused_error | paused_user | completed | failed | stopped | cancelled` (9 values). `paused_user` was added in puzzle-03.
- `createBugReportInputSchema` (`bug-report-schema.ts:139`) — `.strict()` Zod object; defaults `severity="error"`, `description=""`, `context={}`, `refs={}`. Title is `.trim().min(1).max(160)`.
- `bugReportCategorySchema` (`bug-report-schema.ts:57`) — `z.string().regex(SUPPORT_CATEGORY_REGEX)` where `SUPPORT_CATEGORY_REGEX = /^[a-z][a-z0-9_]{2,80}$/` (mirrors SQL CHECK in `019_bug_reports.sql`). Category is NOT a Zod enum so new categories can be added without a coordinated schema migration across all processes.
- `agentBugReportContextSchema` (`bug-report-schema.ts:124`) — `.strict()` Phase 2 context block: `stopReason`, `runtimeStatus`, `contextPressureBand`, `contextPressureFraction`, `checkpointGeneration`, `postCompactBridgeActive`. Only persisted for `source="agent"|"worker"` (enforced in `bug-report-service.ts`).

## Capabilities (stable IDs)

- **CAP-diag-redact-text**: Two-tier string redaction (Tier 1 hard-redact secrets, Tier 2 mask addresses/hashes) — `src/lib/diagnostics/text-redaction.ts:86 redact`
- **CAP-diag-redact-object**: Shallow per-field object wrapper around `redact` with summed counts — `src/lib/diagnostics/text-redaction.ts:166 redactObject`
- **CAP-diag-redact-payload**: Deep recursive composite redactor (key-name + text tiers, depth cap, cycle guard, bigint normalization, size cap) — `src/lib/diagnostics/redactor.ts:122 redactBugPayload`
- **CAP-diag-bug-sink-interface**: `BugReportSink` interface + `AgentBugReportInput` type — `src/lib/diagnostics/bug-report-sink.ts:42`
- **CAP-diag-bug-sink-noop**: No-op default sink; safe to use before vex-app boot wires production sink — `src/lib/diagnostics/bug-report-sink.ts:51 noopBugReportSink`
- **CAP-diag-bug-sink-safe-emit**: Fail-closed emit wrapper that catches and logs sink throws — `src/lib/diagnostics/bug-report-sink.ts:65 emitBugReportSafe`
- **CAP-diag-bug-schema-input**: Zod input schema for bug-report creation with defaults, strict, category regex gate — `src/lib/diagnostics/bug-report-schema.ts:139 createBugReportInputSchema`
- **CAP-diag-bug-schema-runtime-status**: Local mirror of engine run-status enum with CI drift test — `src/lib/diagnostics/bug-report-schema.ts:105 runtimeStatusSchema`
- **CAP-diag-bug-schema-agent-context**: Phase 2 agent-runtime context block schema — `src/lib/diagnostics/bug-report-schema.ts:124 agentBugReportContextSchema`

## Public API (consumed by)

### text-redaction.ts

- `src/vex-agent/memory/redaction.ts` — thin re-export so agent call sites are unchanged; re-exports `redact`, `redactObject`, `RedactionResult`. Consumers of this re-export:
  - `src/vex-agent/engine/compact-jobs/service.ts` → `redact` (compaction summaries)
  - `src/vex-agent/engine/compact-jobs/chunk-processing.ts` → `redact`
  - `src/vex-agent/engine/compact-jobs/archived-prefix.ts` → `redact`, `RedactionResult`
  - `src/vex-agent/tools/internal/memory/mark-resolved.ts` → `redact`

### redactor.ts

- `vex-app/src/main/support/bug-report-service.ts:23` → `redactBugPayload` via `@vex-lib/diagnostics/redactor.js` — runs on every bug-report persist call

### bug-report-sink.ts

- `src/vex-agent/engine/support/bug-report-registry.ts:17` → `noopBugReportSink`, `BugReportSink` — default value for the module-level `currentSink` variable
- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts` → `emitBugReportSafe` (dynamic import via `@vex-lib/diagnostics/bug-report-sink.js`)
- `vex-app/src/main/ipc/mission/_engine-dispatch.ts` → `emitBugReportSafe` (dynamic import)
- `src/vex-agent/engine/core/turn-loop-bug-emit.ts` → `emitBugReportSafe` (dynamic import)
- `src/vex-agent/engine/core/runner/mission-finalize.ts` → `emitBugReportSafe` (dynamic import, two call sites)
- `src/vex-agent/engine/compact-jobs/bug-emit.ts` → `emitBugReportSafe` (dynamic import)
- `src/vex-agent/engine/wake/executor.ts` → `emitBugReportSafe` (dynamic import)
- `vex-app/src/main/support/agent-bug-report-sink.ts:31` → `AgentBugReportInput`, `BugReportSink` types (direct path import, not alias)

### bug-report-schema.ts

- `vex-app/src/shared/schemas/bug-reports.ts` → re-exports all public symbols via `@vex-lib/diagnostics/bug-report-schema.js`
- `vex-app/src/preload/shell/support.ts` → `createBugReportInputSchema` (via shared re-export) for input validation at the preload bridge
- `vex-app/src/main/ipc/support.ts` → `createBugReportInputSchema` (via shared re-export) as `inputSchema` for the IPC handler
- `src/__tests__/lib/diagnostics/runtime-status-sync.test.ts` → `runtimeStatusSchema` directly for the CI drift test

## Internal flow

### Bug-report persist path (user-initiated)

1. Renderer calls `window.vex.support.createReport(input)`.
2. Preload `support.ts` — `invokeWithSchema(createBugReportInputSchema, ...)` validates input shape at Z7 boundary.
3. Z6 `ipc/support.ts` handler validates again with `inputSchema: createBugReportInputSchema`; dispatches to `createBugReport(input, deps)`.
4. `bug-report-service.ts:97` — `redactBugPayload({ title, description, context, refs })` runs the composite deep redactor. Counts stamped into `redactionHardCount` / `redactionMaskCount` columns. `refs.*` are redacted here too to prevent secret-shaped correlation IDs reaching the DB raw.
5. `insertBugReport(insert)` — DB write.
6. `transport.enqueue(id)` — fire-and-forget; currently `noopBugReportTransport` → `uploadState: "not_configured"`.

### Bug-report emit path (agent-automatic)

1. Engine emit site (turn-loop, compact, wake, mission-finalize) calls `getBugReportSink()` from `bug-report-registry.ts` → returns the current sink (noop until vex-app boot mounts the real one).
2. Emit site calls `emitBugReportSafe(sink, input, logger)` — catches any throw; logs at `warn`; returns void.
3. Inside `emitBugReportSafe`: `sink.emit(input)` — in production this is `createAgentBugReportSink().emit`.
4. `createAgentBugReportSink` (`agent-bug-report-sink.ts:46`) — consults rate limiter; if admitted, maps `AgentBugReportInput` → `CreateBugReportInput` and calls `createBugReport`. `agentContext` is passed through; `bug-report-service` drops it for non-agent/worker source.
5. Same `createBugReport` path as user-initiated (step 4–6 above).

### Memory-layer redaction path

1. Compaction pipeline or memory tool calls `redact(text)` via `@vex-agent/memory/redaction.js` re-export.
2. `redact` applies Tier 1 then Tier 2 patterns; returns `RedactionResult`.
3. Caller uses `hardRedactCount` to decide whether to reject a chunk with too-high redaction rate (`compact-jobs` rejects chunks with `hardRedactCount > 0`).

## Dependencies

### Imports FROM

- `src/lib/diagnostics/text-redaction.ts` imports nothing (pure logic + RegExp).
- `src/lib/diagnostics/redactor.ts:25` → `./text-redaction.js` (`redactText`).
- `src/lib/diagnostics/bug-report-sink.ts:17–21` → `./bug-report-schema.js` (types: `AgentBugReportContext`, `CreateBugReportInput`).
- `src/lib/diagnostics/bug-report-schema.ts:15` → `zod` (Zod 4.x, already in root `package.json`).

### Consumed BY (zone map)

- **Z4** `src/vex-agent/memory/redaction.ts` — thin re-export of `text-redaction.ts`; further consumed by compact-jobs + memory tools (`module.vex-agent.data-memory-knowledge`)
- **Z1** `src/vex-agent/engine/support/bug-report-registry.ts` — imports `noopBugReportSink`, `BugReportSink` (`module.vex-agent.engine-runtime-events`)
- **Z1/Z2** engine emit sites (turn-loop, compact bug-emit, wake executor, mission-finalize) — dynamic import `emitBugReportSafe` from `bug-report-sink.ts`
- **Z6** `vex-app/src/main/support/bug-report-service.ts` — `redactBugPayload` via `@vex-lib` alias
- **Z6** `vex-app/src/main/support/agent-bug-report-sink.ts` — `AgentBugReportInput`, `BugReportSink` types (direct path import)
- **Z6** `vex-app/src/main/ipc/support.ts` — `createBugReportInputSchema` via shared re-export
- **Z6** `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts` — dynamic `emitBugReportSafe`
- **Z6** `vex-app/src/main/ipc/mission/_engine-dispatch.ts` — dynamic `emitBugReportSafe`
- **Z7** `vex-app/src/shared/schemas/bug-reports.ts` — full re-export of `bug-report-schema.ts`
- **Z7** `vex-app/src/preload/shell/support.ts` — `createBugReportInputSchema` via shared re-export

## Test coverage

Four test suites, all in `src/__tests__/lib/diagnostics/`:

| Suite | File | What it covers |
|-------|------|----------------|
| `text-redaction.test.ts` | `text-redaction.ts` | Tier 1 patterns (private key, API key, JWT, BIP39); Tier 2 masks (EVM address, tx hash); `redactObject` multi-field sum; zero counts on empty |
| `redactor.test.ts` | `redactor.ts` | Key-name redaction (`[REDACTED]`); Error unwrapping before plain-object branch; depth limit (>8 → `[depth-limit]`); cycle guard (`[circular]`); string truncation (`…[truncated N chars]`); bigint → decimal string; aggregate counts proof |
| `bug-report-sink.test.ts` | `bug-report-sink.ts` | `noopBugReportSink` resolves; `emitBugReportSafe` happy path; swallows Error throw + logs; swallows non-Error throw |
| `bug-report-schema.test.ts` | `bug-report-schema.ts` | `SUPPORT_CATEGORY_REGEX` accepts/rejects; `bugReportCategorySchema`; `createBugReportInputSchema` title trim+reject-empty, max-length, strict extra keys, strict refs, defaults; `createBugReportResultSchema` UUID |
| `runtime-status-sync.test.ts` | `bug-report-schema.ts` + `engine/types.ts` | **CI drift guard**: `runtimeStatusSchema.options` == `MISSION_RUN_STATUSES` (order-independent); `paused_user` present in both |

The drift test uses `.options` (public Zod v4 API) not `._def.values`. Adding a
new status to `engine/types.ts:MISSION_RUN_STATUSES` without mirroring it in
`runtimeStatusSchema` fails CI immediately.

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-diag-redact-payload`, `#CAP-diag-bug-sink-safe-emit`
- quality findings: none currently in `audits/current/quality-findings.md` for this module
- related flows: none (this module is infrastructure, not a flow initiator)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` (no per-session model fields appear in `agentBugReportContext`; `runtimeStatus` is the run-lifecycle status, not a model ID)
- memory re-export: `module.vex-agent.data-memory-knowledge` — `src/vex-agent/memory/redaction.ts`
- bug-sink registry (consumer of this module): `module.vex-agent.engine-runtime-events` — `src/vex-agent/engine/support/bug-report-registry.ts:24 getBugReportSink`

## Refresh triggers

Re-index when any of the following change:

- Any file in `src/lib/diagnostics/**` — the four files in scope.
- `src/vex-agent/engine/types.ts` — `MISSION_RUN_STATUSES` values must stay in sync with `runtimeStatusSchema`.
- `src/vex-agent/memory/redaction.ts` — if it is converted from a re-export to an independent implementation, the shared-module invariant breaks.
- `src/__tests__/lib/diagnostics/**` — test additions extend the coverage picture.
- `vex-app/src/shared/schemas/bug-reports.ts` — if the re-export is replaced by a local copy, the single-source-of-truth invariant breaks.
- `vex-app/src/main/support/bug-report-service.ts` — the primary `redactBugPayload` callsite; trust boundary contract changes here.

## Open questions

- **Solana mask guard (text-redaction.ts:134)**: The `SOLANA_ADDRESS_RE` replace callback contains a guard `if (out.indexOf(HARD_PLACEHOLDER) >= 0 && out.includes(match) === false)` that is logically unusual — it skips a mask if the output contains any `[REDACTED:` placeholder AND the match is not in the output string. Because `out` has already had Tier 1 replacements applied, a match that `SOLANA_ADDRESS_RE` finds will always appear in `out` (unless a Tier 1 replacement consumed the exact same substring). The condition `out.includes(match) === false` would only be true if the regex matched something that was subsequently removed, which cannot happen in a synchronous replace chain. This guard appears to be dead code or a remnant of an earlier guard approach and warrants cleanup.
- **`redactObject` shallow limitation**: The docstring explicitly calls out that arrays of objects are passed through unchanged. This is intentional for the memory-layer use case (shallow object wrapping) but callers must be aware that nested objects in array values are not redacted. No current caller is misusing this, but the API asymmetry between `redactObject` (shallow) and `redactBugPayload` (deep) is a potential future footgun.
- **`agent-bug-report-sink.ts:31` uses a direct path import** (`../../../../../src/lib/diagnostics/bug-report-sink.js`) rather than the `@vex-lib` alias. This is functionally correct (the file resolves to the same module), but inconsistent with other vex-app main-process consumers that use `@vex-lib/diagnostics/…`. A minor cleanup to unify on the alias would reduce fragility if the directory layout changes.
- **Phase 3 upload transport**: `bugReportUploadStateSchema` includes `queued | uploading | uploaded | failed` states but `noopBugReportTransport` always returns `not_configured`. The transport interface and upload-state enum are forward-declared but unimplemented. When Phase 3 lands, this module's schema will need a corresponding transport implementation wired through `createAgentBugReportSink` / `bug-report-service.ts`.
