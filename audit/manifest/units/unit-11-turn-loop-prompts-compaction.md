### 2.11 Work Unit 11 — Turn loop, prompts, compaction

#### Files & LOC

- `src/vex-agent/engine/core/turn-loop.ts` 383 LOC — **god-file/refactor candidate**
- `src/vex-agent/engine/core/turn-loop-tool-batch.ts` 413 LOC — **god-file/refactor candidate**
- `src/vex-agent/engine/core/turn-loop-prompt-stack.ts` modified
- `src/vex-agent/engine/core/turn-loop-plan-acceptance-pause.ts` untracked
- `src/vex-agent/engine/core/turn.ts` 271 LOC
- `src/vex-agent/engine/core/stop-conditions.ts` modified
- `src/vex-agent/engine/prompts/index.ts` modified
- `src/vex-agent/engine/prompts/tool-usage.ts` modified
- `src/vex-agent/engine/prompts/plan.ts` untracked
- `src/vex-agent/engine/compact*`
- `src/vex-agent/db/repos/compact*`

Tests:

- `src/__tests__/vex-agent/engine/core/turn-loop.test.ts` 1,311 LOC — **test god-file**

#### Responsibility

- Run inference/tool loop.
- Build prompt stack.
- Handle stop conditions.
- Process tool batches.
- Pause for approval, wake, compaction, plan acceptance, or engine stop.
- Manage compaction jobs and context pressure.

#### Mechanisms/patterns

- Pressure-band controls.
- Critical/barrier compaction behavior.
- Tool batch execution with approval enqueue.
- Stop reasons (`StopReason`, `engine/types.ts`): `approval_required`, `checkpoint_pause`, `iteration_limit`, `timeout`, `waiting_for_parent`, `waiting_for_wake`, `waiting_for_compact_commit`, `compact_unable_at_critical`, `system_error`, `user_paused`, `plan_acceptance_required`.
  - CORRECTION: `engine_stop` / `compact_committed` are internal `BatchOutcome` kinds (`turn-loop-tool-batch.ts`), **not** StopReasons — the original list conflated the two.
- Prompt modules separate operational/tool usage instructions.
- Plan-mode additions in dirty tree.

#### Dependencies & data-flow

Entry points:

- Runner enters turn loop after hydration.
- Turn loop calls inference provider.
- Tool calls go to `turn-loop-tool-batch.ts` then dispatcher.
- Compaction interacts with DB compact repos and OpenRouter provider.

Imports/dependencies:

- Inference registry/provider.
- Tool dispatcher.
- DB repos for messages/runs/compaction.
- Prompt modules and stop-condition helpers.

Side effects:

- Writes transcript/messages/tool outputs.
- Enqueues approvals.
- Writes compact jobs.
- Updates run/session status.
- Calls external inference provider.

#### Security surface

- LLM output is untrusted and becomes tool calls only through dispatcher/validation.
- Prompt text can influence policy adherence; stale prompt comments are safety risks.
- Compaction may send transcript content to OpenRouter; renderer copy notes redacted/compacted context.
- Tool output/traces must avoid raw secrets.

#### Hotspots

- `turn-loop.ts` and `turn-loop-tool-batch.ts` are both large and policy-sensitive.
- `turn-loop-tool-batch.ts` owns approval enqueue transaction coupling.
- New plan-mode files are untracked/dirty and need full audit.
- Tool descriptions mention stale `restricted/off` language while current `Permission` is `restricted|full`.

`console.*` density:

- No high-density direct console cluster reported; inspect any runtime console hits globally.

#### Tests

Covered:

- Turn loop tests.
- Runner tests.
- Approval/plan-deny tests.
- Stream consumer tests.
- Compaction-related tests.

Not covered / unclear:

- Full prompt regression review.
- Plan acceptance end-to-end across renderer/main/runtime.
- Raw compaction content redaction and provider egress policy.
- Large test maintainability.

#### Open risks/smells

- Audit stale prompt/permission language.
- Review plan-mode dirty changes before relying on behavior.
- Split turn-loop responsibilities after behavior is pinned.
- Verify compaction privacy and provider egress.

