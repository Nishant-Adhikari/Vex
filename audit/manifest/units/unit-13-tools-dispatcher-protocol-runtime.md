### 2.13 Work Unit 13 — Tool registry, dispatcher, protocol runtime, prequote, capture

#### Files & LOC

- `src/vex-agent/tools/dispatcher.ts` 478 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/registry.ts` 384 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/types.ts` 287 LOC
- `src/vex-agent/tools/taxonomy.ts` 73 LOC
- `src/vex-agent/tools/risk-level.ts` 89 LOC
- `src/vex-agent/tools/mutating-aliases.ts` 264 LOC
- `src/vex-agent/tools/protocols/runtime.ts` 415 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/swap-prequote.ts` 1,316 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/mutation-matrix.ts` 135 LOC
- `src/vex-agent/tools/protocols/catalog.ts` 175 LOC
- `src/vex-agent/tools/protocols/types.ts` 236 LOC
- `src/vex-agent/tools/protocols/capture-validator.ts` 149 LOC
- `src/vex-agent/tools/protocols/capture-pipeline.ts` 122 LOC

Tests:

- `src/__tests__/vex-agent/tools/protocols/swap-prequote.test.ts` 1,012 LOC — **test god-file**
- `src/__tests__/vex-agent/tools/protocols/bridge-prequote.test.ts` 683 LOC — **test god-file**
- Protocol taxonomy/discovery/completeness/prequote tests.

#### Responsibility

- Registry defines tool metadata and action classification.
- Dispatcher routes LLM tool calls and enforces pressure/plan/permission gates.
- Protocol runtime executes manifest-defined protocol tools.
- Prequote gate blocks unsafe swap/bridge executes before approval.
- Capture pipeline records protocol executions and updates projections.

#### Mechanisms/patterns

- Required `actionKind` on tools.
- Risk mapping by taxonomy.
- Pressure-band deny for mutating tools.
- Plan acceptance deny for side-effecting tools.
- `markAutoRetryUnsafe` before mutating mission tools.
- `discover_tools` / `execute_tool` meta-tools.
- Protocol manifest lifecycle/executable gating.
- Env requirement checks.
- Primitive param validation.
- Approval gate for restricted mutating protocol tools.
- Prequote fail-closed gate.
- Best-effort capture/audit for protocol execution.

#### Dependencies & data-flow

Entry points:

- Turn loop passes LLM tool calls to dispatcher.
- Dispatcher routes internal tools or protocol runtime.
- Protocol runtime calls protocol handlers under `src/vex-agent/tools/protocols/**`.
- Capture writes DB execution/projection records.

Imports/dependencies:

- DB repos for mission auto-retry unsafe stamp and captures.
- Protocol catalog/manifests.
- Wallet resolution policy.
- Approval preview/prequote data.

Side effects:

- Tool execution.
- DB writes for unsafe stamp/captures.
- External API/RPC calls through handlers.
- Approval queue creation via turn-loop pending approval.

#### Security surface

- LLM output is untrusted at dispatcher boundary.
- `execute_tool` targets must resolve to known manifests/tools.
- Mutating tools require action classification and policy checks.
- Protocol runtime validation is not a full schema boundary for nested objects/unknown keys.
- Capture failures after side effects are logged but generally do not fail successful user action.

#### Hotspots

- `swap-prequote.ts` 1,316 LOC is the top production god-file.
- `dispatcher.ts` 478 LOC and `runtime.ts` 415 LOC hold central policy ordering.
- Primitive-only protocol param validation allows extra/deep fields into handlers.
- Raw protocol error messages can be logged/returned.
- Synthetic captures may bypass normal mutation matrix semantics.
- Naming/comment drift around old loop permissions.

`console.*` density:

- Protocol/tool runtime should use logger. Direct console hits in tool paths need classification under global 37 count.

#### Tests

Covered:

- Runtime type validation.
- Action taxonomy.
- Protocol taxonomy/discovery/completeness.
- Prequote gate.
- Protocol wallet scope.
- Signer import allowlist.
- Dispatcher plan-deny tests.
- Kyber/Polymarket/Khalani handler tests.

Not covered / unclear:

- Strict nested schema rejection.
- Raw provider error redaction.
- Capture failure behavior after partial side effects.
- Complete `runTool` exposure/caller audit.

#### Open risks/smells

- Replace primitive validation with strict generated schemas/Zod.
- Split `swap-prequote.ts` into identity builders, gate evaluators, recorders, safety classifiers.
- Add tests for raw error redaction.
- Audit all direct protocol runtime callers for wallet scope defaults.

#### Additional audit lens — "Writing tools for agents" (Anthropic)

Reference: <https://www.anthropic.com/engineering/writing-tools-for-agents>. Apply this
when judging whether the **agent-facing tool surface is well-constructed** (not only
whether it is safe). The surface the LLM actually sees is defined in the manifests,
registry, taxonomy, aliases, and the `discover_tools` / `execute_tool` meta-tools —
audit those, not just the handlers.

Checklist (article principle → what to verify in Vex → where):

1. **Right tools / consolidation** — tools should target high-impact workflows and
   consolidate related operations, not 1:1-wrap every protocol endpoint. Verify the
   action/`swap` alias consolidation (`tools/mutating-aliases.ts`,
   `tools/registry/action-aliases.ts`, `tools/internal/action-aliases.ts`,
   `tools/internal/swap-family.ts`) genuinely reduces agent steps; scan the manifest
   catalog (`tools/protocols/catalog.ts`, `tools/protocols/*/manifests/*.ts`) for
   redundant/overlapping tools that confuse the model.
2. **Namespacing & naming** — related tools grouped under clear prefixes reflecting
   natural task subdivisions. Verify tool names in the manifests + `tools/taxonomy.ts`
   are consistently namespaced and that `discover_tools` presents them coherently.
3. **Descriptions & parameter naming** — descriptions written for "a new hire" (implicit
   context made explicit); unambiguous param names (`user_id`, not `user`); strict,
   documented I/O models. Verify manifest descriptions + the tool-usage prompt
   (`engine/prompts/tool-usage.ts`, Unit 11). **Direct tie-in:** primitive-only param
   validation with no strict/nested schema (see §Security surface / §Hotspots) violates
   the "strict data models" guidance — same finding, second lens.
4. **Meaningful, high-signal return context** — prefer natural-language identifiers over
   cryptic IDs; offer a `response_format` (`concise` / `detailed`). Verify what handlers
   and `tools/protocols/runtime.ts` actually return to the model (raw provider blobs vs
   distilled high-signal results) and whether any verbosity control exists.
5. **Token efficiency** — pagination / filtering / truncation with sensible defaults; cap
   response tokens; truncation should include steering instructions. Verify tool-output
   handling (`tools/protocols/runtime.ts`, capture pipeline,
   `db/repos/tool-output-blobs.ts`): are large protocol/web/RPC payloads bounded before
   they reach context, and does truncation tell the agent how to narrow next time?
6. **Actionable error messages** — errors should give specific, actionable improvements,
   not opaque codes. **Overlaps the raw-error-leakage finding:** redact provider internals
   (security) *and* rewrite into agent-steering guidance (tool quality). Verify error text
   returned from `runtime.ts` / handlers.
7. **Evaluation-driven iteration** — tool quality should be measured (accuracy, tool-call
   count, tokens, errors) on a real-task eval set. Verify whether a tool-level eval harness
   exists (`src/__tests__/eval/**`) and whether manifests/descriptions are iterated against
   it, or only unit-tested for correctness.

