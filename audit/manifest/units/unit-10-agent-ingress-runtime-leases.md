### 2.10 Work Unit 10 — Agent ingress, runtime leases, workers

#### Files & LOC

- `src/vex-agent/engine/ingress.ts` 198 LOC
- `src/vex-agent/engine/core/runner/agent.ts` 164 LOC
- `src/vex-agent/engine/core/runner/mission-run.ts` 312 LOC — core state-machine (CORRECTION: under the ~300–400 LOC god-file threshold and absent from §5; the original "god-file/refactor candidate" label was an inconsistency)
- `src/vex-agent/engine/core/runner/mission.ts` 172 LOC
- `src/vex-agent/engine/core/runner/setup-turn.ts` modified
- `src/vex-agent/engine/core/runner/shared.ts` modified
- `src/vex-agent/engine/runtime/control-bus.ts` modified
- `src/vex-agent/engine/runtime/**`
- `src/vex-agent/engine/wake/executor.ts` 425 LOC — **god-file/refactor candidate**
- `vex-app/src/main/agent/transcript-bridge.ts` 90 LOC
- `vex-app/src/main/agent/control-bridge.ts` 39 LOC
- `vex-app/src/main/agent/stream-bridge.ts` 160 LOC

#### Responsibility

- Route user messages into active/new mission turns.
- Manage mission run lease, status, abort, pause/resume, wake, and runtime control.
- Bridge engine transcript/control/stream events from runtime to Electron main/preload/renderer.

#### Mechanisms/patterns

- Lease-based mission execution.
- Abort controllers for pause/stop/cancel.
- Status transitions for active/paused/wake/error states.
- Runtime control bus.
- Worker startup/shutdown through main lifecycle.
- Transcript/control/stream bridge event DTOs.

#### Dependencies & data-flow

Entry points:

- Main chat/mission/runtime IPC handlers.
- Wake executor and auto-retry flows.
- User messages from renderer via main IPC.

Imports/dependencies:

- Runner imports DB repos, inference, prompts, tool dispatch.
- Main bridges import runtime event emitters and shared event schemas.
- Lifecycle cleanup stops workers before Compose/Postgres shutdown.

Side effects:

- DB mission/session status updates.
- Runtime event broadcasts.
- Long-lived workers/timers.
- Abort/cancel state mutation.

#### Security surface

- Renderer can request pause/stop/resume but main/runtime enforce state.
- Runtime must not leak raw provider/tool data through stream events.
- Mission auto-retry must not retry unsafe mutating actions.
- Worker shutdown must not leave DB locks/timers/socket handles.

#### Hotspots

- `mission-run.ts` 312 LOC is core state-machine code.
- `wake/executor.ts` 425 LOC is long-lived and operationally sensitive.
- Dirty plan-mode changes affect runner/status behavior.
- Silent bridge teardown errors in main agent bridge reduce debuggability.
- Stale sync/mission running recovery needs confirmation.

`console.*` density:

- Runtime should use structured logger. Direct console hits in runtime should be audited globally.

#### Tests

Covered:

- Runner tests, including `src/__tests__/vex-agent/engine/core/runner.test.ts` 821 LOC.
- Runtime lease/status tests.
- Mission auto-retry tests.
- Wake/runtime control tests.
- Main runtime resume dispatch tests, including new plan test.

Not covered / unclear:

- End-to-end app quit/update restart cleanup.
- Stale running row recovery across crashes.
- Full dirty plan-mode lifecycle semantics.
- Worker drain ordering under failures.

#### Open risks/smells

- Audit plan-mode dirty changes against all mission statuses.
- Add stale-running recovery coverage where absent.
- Improve teardown diagnostics.
- Keep worker shutdown ordered before DB/Compose stop.

