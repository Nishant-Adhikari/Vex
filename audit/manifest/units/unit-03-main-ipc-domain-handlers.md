### 2.3 Work Unit 3 — Main IPC domain handlers

#### Files & LOC

- `vex-app/src/main/ipc/docker.ts` 286 LOC
- `vex-app/src/main/ipc/database.ts` 155 LOC
- `vex-app/src/main/ipc/secrets.ts` 110 LOC
- `vex-app/src/main/ipc/wallet-export.ts` 335 LOC — **god-file/refactor candidate**
- `vex-app/src/main/ipc/chat.ts` 177 LOC
- `vex-app/src/main/ipc/approvals.ts` 318 LOC — **god-file/refactor candidate**
- `vex-app/src/main/ipc/support.ts` 69 LOC
- `vex-app/src/main/ipc/onboarding/wallets.ts` 704 LOC — **god-file/refactor candidate**
- `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` 520 LOC — **god-file/refactor candidate**
- `vex-app/src/main/ipc/runtime/_ensure-engine-db-url.ts` 49 LOC
- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts` 216 LOC
- `vex-app/src/main/ipc/sessions/plan.ts` 175 LOC

Tests:

- `vex-app/src/main/ipc/onboarding/__tests__/polymarket-setup.test.ts` 921 LOC — **test god-file**
- `vex-app/src/main/ipc/__tests__/wallet-export.test.ts` 881 LOC — **test god-file**
- `vex-app/src/main/ipc/onboarding/__tests__/wallets.test.ts` 829 LOC — **test god-file**
- `vex-app/src/main/ipc/__tests__/register-handler.test.ts` 681 LOC — **test god-file**

#### Responsibility

- Domain IPC handlers translate typed renderer requests into main-owned services.
- Docker/database handlers own local-service lifecycle and migration progress.
- Secrets/wallet-export handlers own vault unlock/lock and private key clipboard export.
- Chat/runtime/mission/approvals handlers bridge into `src/vex-agent`.
- Onboarding handlers own provider/wallet/Polymarket setup workflows.

#### Mechanisms/patterns

- All handlers should use `registerHandler`.
- Shared schemas validate request/output DTOs.
- Handlers return redacted `Result<T>`.
- Long-running/cancelable paths use abort signals.
- Main strips sensitive internal fields before returning DTOs.
- Runtime dispatch helpers isolate agent bridge behavior.

#### Dependencies & data-flow

Entry points:

- Preload domain methods call these handlers.
- Renderer API hooks wrap many of the returned DTOs.

Imports/dependencies:

- Handlers import shared schemas and main services.
- Agent-facing handlers call `src/vex-agent` through main bridge/import paths.
- Docker/database handlers depend on Compose/Docker/DB modules.

Side effects:

- Docker CLI operations.
- DB migrations and connection-state updates.
- Secret vault decrypt/scrub/env mutation.
- Clipboard write/auto-clear.
- Agent runtime mission/chat/approval mutations.
- Support bundle/report generation.

#### Security surface

- Every handler is a renderer→main trust-boundary endpoint.
- Highest-risk handlers:
  - `wallet-export.ts`: private key export to clipboard.
  - `onboarding/wallets.ts`: wallet import/restore.
  - `onboarding/polymarket-setup.ts`: protocol credentials setup.
  - `approvals.ts`: approve/reject mutating actions.
  - runtime/mission handlers: pause/resume/retry/edit state transitions.
- Validation boundary is shared schemas plus handler-level runtime checks.

#### Hotspots

- `onboarding/wallets.ts` 704 LOC and `onboarding/polymarket-setup.ts` 520 LOC concentrate sensitive setup logic.
- Large onboarding tests indicate complex flows with high maintenance cost.
- `wallet-export.ts` is security-critical and 335 LOC.
- Some runtime dispatch/bug-report failure paths swallow or downgrade errors after logging.
- Need check whether migration failure details can leak DB connection strings to renderer.

`console.*` density:

- Main packaged console output is generally disabled through logger setup; direct console use should be reviewed under global 37 hits.

#### Tests

Covered:

- Wallet export reauth/clipboard behavior.
- Onboarding wallet flows.
- Polymarket setup.
- Docker compose-up cancellation/single-flight.
- Database migration progress.
- Handler registration/error validation.

Not covered / unclear:

- Full semantic audit of new session-plan IPC files.
- All mission/runtime resume edge cases.
- Handler-by-handler local path/secret redaction.
- Full channel-to-handler reconciliation.

#### Open risks/smells

- Split sensitive onboarding IPC files when behavior is pinned.
- Ensure every handler supplies output schemas.
- Audit all handler error messages for redaction.
- Reconcile reserved channels and new plan/session behavior.

