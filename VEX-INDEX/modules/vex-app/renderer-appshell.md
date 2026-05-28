---
id: module.vex-app.renderer-appshell
kind: module
paths:
  - "vex-app/src/renderer/**"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "vex-app/src/renderer/**"
  - "vex-app/src/preload/**"
  - "vex-app/src/shared/schemas/**"
  - "vex-app/src/shared/types/bridge/**"
  - "vex-app/src/main/ipc/**"
related:
  - module.vex-app.preload-shared-contracts
  - module.vex-app.main-process
  - fix-plan.F3
  - ADR-0001-global-model-session-wallet
---

# vex-app Renderer / App Shell

## Purpose

Untrusted React UI for onboarding, local-service bootstrap, sessions, transcript, approvals,
runtime status, settings/reconfigure, and support surfaces. All privileged work goes through
`window.vex`.

## File map

- `vex-app/src/renderer/App.tsx:40` route map: splash -> systemCheck -> dockerBootstrap -> composeBootstrap -> migrations -> wizard -> unlock -> appShell.
- `features/wizard/WizardShell.tsx:174` conditional unlock routing after completed setup.
- `features/appShell/AppShell.tsx` shell layout and subviews.
- `features/appShell/SessionPanel.tsx:93` active session layout.
- `features/appShell/ApprovalsRegion.tsx:38` polling region for pending approvals.
- `features/appShell/ApprovalCard.tsx:105` approve/reject invalidation.
- `features/appShell/SessionRuntimeBar.tsx:99` global model indicator and usage/context chips.
- `stores/uiStore.ts` routing/session/filter/modals; `streamStore.ts` ephemeral stream preview.
- `lib/api/**` TanStack Query wrappers over `window.vex`.

## Key invariants

- Renderer must not import Electron, Node, DB, Docker, wallet/signing, or `src/vex-agent`.
- Provider API key and raw wallet import forms intentionally avoid long-lived React Query/Zustand secret state.
- Approval cards poll because control-state is not bridged. Do not assume a live control-state subscription exists.
- Global model is read-only from `sessions.getModel`; session wallet is per-session at creation/scope.

## Known gaps

- F3 fixed: `ApprovalsRegion` is mounted between transcript and composer.
- Updater UI is absent beyond placeholder constants/preferences.
- Transcript has a finite page cap/no virtualization; slash placeholder lists fewer commands than implemented.
- Approval UI is generic; provider-hot-wallet disclosure adequacy depends on backend preview fields.

## Refresh triggers

Any renderer feature/hook/store changes, shared schema/bridge changes, or main IPC result-shape changes.
