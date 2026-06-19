### 2.2 Work Unit 2 — IPC/preload/shared contracts

#### Files & LOC

- `vex-app/src/main/ipc/register-handler.ts` 377 LOC — **god-file/refactor candidate**
- `vex-app/src/main/ipc/register-all.ts` 106 LOC
- `vex-app/src/shared/ipc/channels.ts` 294 LOC — near god-file threshold, high-blast-radius
- `vex-app/src/shared/ipc/result.ts` 339 LOC — **god-file/refactor candidate**
- `vex-app/src/shared/ipc/envelope.ts` 19 LOC
- `vex-app/src/preload/_dispatch.ts` 139 LOC
- `vex-app/src/preload/index.ts` 36 LOC
- `vex-app/src/preload/agent/sessions.ts` 79 LOC
- `vex-app/src/shared/schemas/sessions.ts` 253 LOC
- `vex-app/src/shared/schemas/session-plan.ts` 81 LOC
- `vex-app/src/shared/types/bridge/agent/sessions.ts` 71 LOC

Tests:

- `vex-app/src/main/ipc/__tests__/register-handler.test.ts` 681 LOC — **test god-file**
- `vex-app/src/main/ipc/__tests__/ipc-handler-surface.test.ts` 600 LOC — **test god-file**
- `vex-app/src/preload/__tests__/bridge-surface.test.ts` 191 LOC

#### Responsibility

- `channels.ts`: source of truth for IPC request/event channels.
- `result.ts`: shared `Result<T>` and redacted `VexError` contract.
- `envelope.ts`: request envelope shape.
- `register-handler.ts`: central main-side trust-boundary enforcement.
- `register-all.ts`: central registration of all handler domains.
- `_dispatch.ts`: preload-side schema validation, request IDs, invoke, abort, subscriptions.
- `preload/index.ts`: exposes `window.vex`.
- shared schemas/types: payload and return DTO contracts.

#### Mechanisms/patterns

- Zod request validation in preload and main.
- Main-side output validation.
- Redacted strict error shape.
- Correlation IDs.
- AbortController registry and `cancel` channel.
- Domain-specific bridge methods instead of raw channel exposure.
- Bridge surface tests and handler surface tests.

#### Dependencies & data-flow

Entry points:

- Renderer calls `window.vex.*`.
- Preload calls `_dispatch.invokeWithSchema`, `abortableInvoke`, or `subscribe`.
- Main receives through `register-handler.ts`.
- Handlers registered through `register-all.ts`.

Imports/dependencies:

- Preload imports shared schemas and bridge types.
- Main handlers import `registerHandler` plus shared schemas.
- Renderer imports bridge types only via ambient `vex.d.ts`.

Side effects:

- IPC handler registration.
- Event subscription registration and cleanup.
- Abort/cancel registry mutation.

#### Security surface

- Primary renderer→main trust boundary.
- Sender validation blocks untrusted origins/frames.
- Payload validation blocks malformed renderer input.
- Error shape validation prevents raw exception objects from crossing.
- Output schemas reduce accidental privileged-data leakage.

#### Hotspots

- `register-handler.ts` centralizes many concerns and is 377 LOC.
- `result.ts` is 339 LOC and growing; error domain/code catalog can become hard to maintain.
- Channel constants include reserved/unimplemented surfaces; reconcile actual handlers and bridge exposure.
- Preload does not independently validate returned `Result<T>` from main.

`console.*` density:

- Global scoped count is 37. No high-density console cluster was identified in this unit; logging should remain via main logger and structured error contracts.

#### Tests

Covered:

- Handler sender/envelope/payload/output/error validation.
- IPC handler surface.
- Preload bridge does not expose raw IPC.

Not covered / unclear:

- Complete CH/EV constant to registered-handler/preload-method reconciliation.
- Defense-in-depth validation of returned `Result<T>` in preload.
- New plan/session channel semantics in dirty working tree need full semantic audit.

#### Open risks/smells

- Add/prefer preload-side returned-result validation.
- Reconcile reserved updater/database/system channels.
- Keep raw channel names out of renderer.
- Treat new bridge/schema additions as security-sensitive.

