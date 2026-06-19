### 2.12 Work Unit 12 — Mission approvals and policy runtime

#### Files & LOC

- `src/vex-agent/engine/core/approval-runtime/post-tx.ts` 428 LOC — **god-file/refactor candidate**
- `src/vex-agent/engine/core/approval-runtime/snapshot.ts` 301 LOC — **god-file/refactor candidate**
- `src/vex-agent/engine/core/approval-runtime.ts` 225 LOC
- `src/vex-agent/engine/core/approval-runtime/helpers.ts` 102 LOC
- `src/vex-agent/engine/core/approval-runtime/continuation.ts` 98 LOC
- `src/vex-agent/engine/core/approval-runtime/sweep.ts` 64 LOC
- `src/vex-agent/engine/core/approval-intent-preview.ts` 244 LOC
- `src/vex-agent/db/repos/approvals.ts` 174 LOC
- `src/vex-agent/db/repos/approval-intents.ts` 305 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/migrations/024_approval_intents.sql` 84 LOC
- `vex-app/src/main/ipc/approvals.ts` 318 LOC — **god-file/refactor candidate**

Tests:

- `src/__tests__/vex-agent/engine/core/approval-runtime.test.ts` 832 LOC — **test god-file**

#### Responsibility

- Durable approval queue/intents.
- Approval preview construction.
- Approve/reject/expire transitions.
- Post-approval dispatch of originally paused mutating tool.
- Main IPC approve/reject/list/history surface.

#### Mechanisms/patterns

- `approval_queue` and `approval_intents`.
- DB transaction coupling with `paused_approval` mission state.
- `FOR UPDATE` row locks.
- TTL based on DB `NOW()`.
- CAS/idempotency.
- Permission snapshot at enqueue.
- Safe preview allowlist.
- Structural-only failure hashes.

#### Dependencies & data-flow

Entry points:

- Tool batch receives `pendingApproval`.
- Renderer approval UI calls main approvals IPC.
- Main approvals IPC calls approval runtime.
- Approval runtime dispatches approved tool post-transaction.

Imports/dependencies:

- Tool dispatcher for post-approval execution.
- DB repos for approvals/intents/missions/messages.
- Wallet/session hydration for approved dispatch.
- Renderer DTO schemas.

Side effects:

- Inserts/updates approvals/intents.
- Pauses/resumes mission runs.
- Dispatches mutating tools after user approval.
- Appends tool result/failure messages.
- Updates runtime status.

#### Security surface

- Critical user decision boundary for mutating and wallet-broadcast actions.
- Approval preview must be complete and non-misleading.
- Stored policy snapshot may not be fully enforced at approve time.
- Approved dispatch runs with `approved:true`.

#### Hotspots

- `post-tx.ts` 428 LOC: complex ordering after approval.
- `snapshot.ts` 301 LOC: lock/TTL/CAS authority.
- Approval `policy_json` capture exists, but live diff/enforcement was not obvious.
- Approval DTO completeness depends on upstream prequote/tool result.
- Main `approvals.ts` is 318 LOC and bridges renderer decisions into runtime authority.

`console.*` density:

- Approval failure paths use structural hashes; verify all logging uses redacted logger and not direct console.

#### Tests

Covered:

- Approval runtime CAS/TTL/post-tx failure behavior.
- Approval intent repo tests.
- Renderer approval UI tests.
- Main approval IPC tests.
- Policy and action taxonomy tests.

Not covered / unclear:

- Live revalidation of stored `policy_json`.
- End-to-end LLM tool call → approval UI → wallet broadcast.
- Approval preview completeness for every protocol.
- Race between wallet selection changes and approval.

#### Open risks/smells

- Audit whether `policy_json` should be enforced, not just stored.
- Verify approved dispatch cannot change target/action semantics.
- Add E2E approval/broadcast integration tests.
- Keep approval preview allowlist aligned with new protocol fields.

