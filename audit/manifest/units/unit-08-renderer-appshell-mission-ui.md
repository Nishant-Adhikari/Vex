### 2.8 Work Unit 8 — Renderer app shell and mission UI

#### Files & LOC

- `vex-app/src/renderer/features/appShell/__tests__/AppShell.test.tsx` 1,447 LOC — **test god-file**
- `vex-app/src/renderer/features/appShell/SessionRows.tsx` 416 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/appShell/SessionCreator.tsx` 380 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/appShell/ApprovalCard.tsx` 305 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/appShell/SessionPanel.tsx` modified in working tree
- `vex-app/src/renderer/features/appShell/SessionPlanCard.tsx` committed/tracked (CORRECTION: not "untracked" — verified)
- `vex-app/src/renderer/features/appShell/composer-helpers.ts` modified
- `vex-app/src/renderer/lib/api/sessions.ts` modified
- `vex-app/src/renderer/stores/uiStore.ts` 154 LOC
- `vex-app/src/renderer/components/ui/dotmatrix-core.tsx` 960 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/components/dotmatrix-loader.css` 1,121 LOC — **god-file/refactor candidate**

#### Responsibility

- App shell renders sessions, transcript, composer, mission controls, approvals, runtime status, knowledge/memory panels.
- API hooks adapt `window.vex` calls to TanStack Query.
- Store tracks UI-only state and bounded logs.
- Approval card shows pending mutating action details and user decision controls.

#### Mechanisms/patterns

- TanStack Query for server/runtime state.
- Zustand for UI state.
- Bounded `uiStore` log buffer at 500.
- Transcript infinite query bounded to 10 pages x 50 messages.
- Approval UX defaults to reject focus and uses extra confirmation for high/critical/destructive/user-wallet-broadcast actions.
- Markdown rendering escapes raw HTML and constrains absolute HTTPS links.

#### Dependencies & data-flow

Entry points:

- `App.tsx` enters app shell after setup/unlock.
- App shell hooks call `window.vex.sessions`, `mission`, `runtime`, `approvals`, `messages`, `knowledge`, etc.
- Engine events stream through preload subscriptions into renderer state.

Imports/dependencies:

- Renderer uses shared bridge types and API adapters.
- No privileged imports in inspected renderer paths.

Side effects:

- UI state persistence of `sidebarOpen`.
- Query cache state.
- No direct wallet/DB/Docker side effects.

#### Security surface

- Approval UI is the user-facing gate for mutating actions.
- Renderer must not be the source of truth for approval validation.
- Approval card completeness depends on upstream DTOs including chain/token/amount/gas/risk context.
- Renderer must not persist secrets or raw private data in localStorage.

#### Hotspots

- `dotmatrix-loader.css` 1,121 LOC and `dotmatrix-core.tsx` 960 LOC are visual/animation god-files.
- `AppShell.test.tsx` 1,447 LOC is large and hard to scan.
- `SessionRows.tsx`, `SessionCreator.tsx`, `ApprovalCard.tsx` are large UI files.
- `streamStore` preview text is bounded only implicitly by engine output limits; no explicit renderer byte cap found.
- App shell plan-mode changes in dirty worktree need semantic audit.

`console.*` density:

- Renderer root reports errors through support/telemetry; no high-density direct console cluster reported.

#### Tests

Covered:

- App shell tests.
- Stores.
- Runtime hooks.
- Mission controls.
- Approvals.
- Transcript.
- Markdown.
- Session list/creator behavior.

Not covered / unclear:

- End-to-end approval DTO completeness for every protocol/action.
- Renderer stream preview explicit cap.
- Virtualization under large transcripts.
- Plan-card/session-plan dirty working tree semantics.

#### Open risks/smells

- Verify approval preview data is complete enough for user financial decisions.
- Add explicit stream/preview byte cap.
- Split large visual/test files when behavior is pinned.
- Audit new plan UI against engine policy and IPC contracts.

