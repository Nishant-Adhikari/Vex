# Batch P2-D — Renderer wizard/wallet component splits (A-049, A-050, A-051, A-052)

**Baseline:** `HEAD == origin/main == 1a66c7e`. Clean tree. 4 Opus agents parallel, file-disjoint, all vex-app renderer (React/TSX). Nested-subdir convention. ZERO behavior change.
**React specifics:** the original file KEEPS its public export (the component + its Props interface). Extract presentational SUBCOMPONENTS, custom HOOKS / state logic, and helpers into co-located modules under a subdir named after the component. Preserve rendering, state, effects, event handlers, and ACCESSIBILITY (roles/labels/focus). The existing `.test.tsx` (testing-library/jsdom) is the PRIMARY guard and must pass unchanged. Renderer stays untrusted — NO Node/Electron/privileged imports; only `window.vex` bridge + shared types (process-boundary check enforces).

## A-049 — `wizard/steps/ApiKeysStep.tsx` (491) — has co-located `api-keys/form-helpers.ts`
**Exports (exact):** `ApiKeysStepProps` (interface), `ApiKeysStep` (component).
Extract under `ApiKeysStep/` (or extend existing `api-keys/`): `ProviderKeyCard.tsx`, `ApiKeyActions.tsx`, a `useApiKeysState` hook / `state.ts`, validation helpers. Keep `ApiKeysStep` shell + `ApiKeysStepProps`. Importers (untouched): WizardShell, WizardStepPanel, api-keys/form-helpers. Guard: `__tests__/ApiKeysStep.test.tsx`.

## A-050 — `wizard/steps/EmbeddingStep.tsx` (394)
**Exports (exact):** `EmbeddingStepProps`, `EmbeddingStep`.
Extract under `EmbeddingStep/`: `ProviderSelector.tsx`, `EmbeddingProgress.tsx`, `state.ts`/hook. Keep shell + Props. Importers (untouched): WizardShell, WizardStepPanel, ReviewStep. Guard: `__tests__/EmbeddingStep.test.tsx`.

## A-051 — `wizard/steps/wallets/RestoreFromArchive.tsx` (414)
**Export (exact):** `RestoreFromArchive` (component).
Extract under `RestoreFromArchive/`: `ArchivePicker.tsx`, `RestorePasswordForm.tsx`, `RestoreProgress.tsx`, `RestoreResult.tsx`, `state.ts`/hook. Keep shell. IPC stays through `window.vex`. Importer (untouched): WalletsStep. Guard: `__tests__/RestoreFromArchive.test.tsx`.

## A-052 — `wallets/ExportPrivateKeyModal.tsx` (392) — SECURITY-sensitive (private-key export UI)
**Exports (exact):** `ExportPrivateKeyModalProps`, `ExportPrivateKeyModal`.
Extract under `ExportPrivateKeyModal/`: `ConfirmPanel.tsx`, `PasswordPanel.tsx`, `ExportResult.tsx`, `state.ts`/hook. Keep shell + Props. CRITICAL: never persist/log the private key; the key stays only in the local state it already lives in (do not lift it to a wider scope, console, or storage); the confirmation UX + clear-on-close behavior preserved. Importers (untouched): ExportLockIcon, PolymarketSudoModal, ReviewStep. Guard: `__tests__/ExportPrivateKeyModal.test.tsx` (asserts no key in logs/state snapshots).

## Verification (owned by main Claude)
`vex-app lint` (tsc + process-boundary check — renderer purity) + vex-app vitest over the 4 component tests (+ WizardShell/WalletsStep where they import these). git scope: 4 components modified + 4 subdirs; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. For each component: what is cleanly extractable (presentational subcomponents, custom hooks, validation/format helpers) vs must stay in the main component (top-level state, effect wiring, the props contract)? Cite lines.
2. A-052: where does the private key live in state, and what clears it (on close/unmount)? Confirm the split keeps it local + cleared, and never logs/persists it. Cite lines.
3. Any shared hook/helper across these that already exists (don't duplicate)? Any renderer-purity risk (a privileged import) in the extracted modules?
4. Anything to serialize, or an additional guard (a11y role/label preservation).
