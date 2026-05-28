---
id: module.vex-app.renderer-onboarding-bootstrap-secrets
kind: module
title: Renderer Onboarding, Bootstrap & Secrets UI
description: Pre-app-shell flow. Splash → SystemCheck → Docker → Compose → Migrations → Wizard (7 steps) → Unlock → AppShell. Renderer-side IPC contracts, form state management, password handling, and env-state synchronization.
source_commit: cf05003
indexed_at: 2026-05-28
paths:
  - vex-app/src/renderer/App.tsx
  - vex-app/src/renderer/stores/uiStore.ts
  - vex-app/src/renderer/features/splash/IntroScreen.tsx
  - vex-app/src/renderer/features/splash/useLoaderProgress.ts
  - vex-app/src/renderer/features/systemCheck/SystemCheck.tsx
  - vex-app/src/renderer/features/systemCheck/StepRow.tsx
  - vex-app/src/renderer/features/docker/BootstrapPanel.tsx
  - vex-app/src/renderer/features/docker/InstallProgress.tsx
  - vex-app/src/renderer/features/docker/LicenseNotice.tsx
  - vex-app/src/renderer/features/docker/LinuxManualInstructions.tsx
  - vex-app/src/renderer/features/docker/bootstrap/**
  - vex-app/src/renderer/features/compose/ComposeBootstrap.tsx
  - vex-app/src/renderer/features/compose/bootstrap/**
  - vex-app/src/renderer/features/database/Migrations.tsx
  - vex-app/src/renderer/features/database/migrations/**
  - vex-app/src/renderer/features/secrets/UnlockScreen.tsx
  - vex-app/src/renderer/features/wallets/ExportLockIcon.tsx
  - vex-app/src/renderer/features/wallets/ExportPrivateKeyModal.tsx
  - vex-app/src/renderer/features/wallets/ExportWalletPicker.tsx
  - vex-app/src/renderer/features/wizard/WizardShell.tsx
  - vex-app/src/renderer/features/wizard/WizardStepPanel.tsx
  - vex-app/src/renderer/features/wizard/HorizontalStepper.tsx
  - vex-app/src/renderer/features/wizard/stepper/**
  - vex-app/src/renderer/features/wizard/wizard-icons.ts
  - vex-app/src/renderer/features/wizard/steps/KeystoreStep.tsx
  - vex-app/src/renderer/features/wizard/steps/WalletsStep.tsx
  - vex-app/src/renderer/features/wizard/steps/ApiKeysStep.tsx
  - vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx
  - vex-app/src/renderer/features/wizard/steps/AgentCoreStep.tsx
  - vex-app/src/renderer/features/wizard/steps/ProviderStep.tsx
  - vex-app/src/renderer/features/wizard/steps/PlaceholderStep.tsx
  - vex-app/src/renderer/features/wizard/steps/agent-core/**
  - vex-app/src/renderer/features/wizard/steps/api-keys/**
  - vex-app/src/renderer/features/wizard/steps/polymarket-auto-setup/**
  - vex-app/src/renderer/features/wizard/steps/provider/**
  - vex-app/src/renderer/features/wizard/steps/review/**
  - vex-app/src/renderer/features/wizard/steps/wallets/**
  - vex-app/src/renderer/components/common/AddressDisplay.tsx
  - vex-app/src/renderer/components/common/PasswordField.tsx
  - vex-app/src/renderer/components/common/StrengthMeter.tsx
  - vex-app/src/renderer/components/onboarding/**
  - vex-app/src/renderer/lib/api/onboarding.ts
  - vex-app/src/renderer/lib/api/api-keys.ts
  - vex-app/src/renderer/lib/api/wizard.ts
  - vex-app/src/renderer/lib/api/polymarket.ts
  - vex-app/src/renderer/lib/api/provider.ts
  - vex-app/src/renderer/lib/api/embedding.ts
  - vex-app/src/renderer/lib/api/agent-core.ts
  - vex-app/src/renderer/lib/api/docker.ts
  - vex-app/src/renderer/lib/api/wallets.ts
  - vex-app/src/renderer/lib/api/wallet-inventory.ts
  - vex-app/src/renderer/lib/api/finalize.ts
stale_when_paths_change:
  - vex-app/src/main/ipc/onboarding/**
  - vex-app/src/main/onboarding/provider-writer.ts
  - vex-app/src/main/onboarding/keystore-writer.ts
  - vex-app/src/main/onboarding/apikeys-writer.ts
  - vex-app/src/main/onboarding/embedding-writer.ts
  - vex-app/src/main/onboarding/agent-core-writer.ts
  - vex-app/src/shared/schemas/wizard.ts
  - vex-app/src/shared/schemas/secrets.ts
  - vex-app/src/shared/schemas/onboarding.ts
  - vex-app/src/shared/ipc/channels.ts
related:
  - module.vex-app.main-docker-compose-onboarding
  - module.vex-app.main-secrets-wallet-support
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-app.renderer-appshell-runtime
  - module.vex-agent.data-memory-knowledge
  - fix-plan.F1
  - ADR-0001-global-model-session-wallet
---

## Purpose

This module documents the renderer's pre-app-shell initialization flow: the complete journey from cold-start splash screen through onboarding (system check, Docker/Compose bootstrap, database migrations, multi-step wizard) to vault unlock and app shell entry.

The renderer is **untrusted**; all state mutations, side effects, and privileged operations (env writes, vault access, provider setup, wallet generation) flow through `window.vex.*` IPC bridges to the main process. This document traces that boundary at every step, with special attention to:

- **Secret handling**: passwords, API keys, private keys are never stored in React state, Zustand, or TanStack Query. They live transiently in uncontrolled DOM refs or main-process-only memory.
- **State routing**: the view state machine (Zustand `useUiStore`) deterministically routes based on preload status queries (`secrets.status()`, `wizard.getState()`).
- **Writer atomicity**: each wizard step's submit calls a dedicated main-process writer (e.g. `provider-writer`, `keystore-writer`) that validates, persists vault secrets, and rewrites `.env` inside an exclusive lock.
- **Form validation**: Zod schemas validate at renderer boundaries; submission always calls the IPC handler, which re-validates server-side.

## Retrieval keywords

splash, intro, system check, docker bootstrap, compose bootstrap, docker install, compose up, database migration, wizard, wizard shell, keystore step, master password, wallets step, wallet inventory, api keys step, embedding step, agent core step, provider step, polymarket auto setup, unlock screen, password field, strength meter, vault unlock, env state, install progress, license notice, system check

## State owned

- **Zustand `uiStore` (persistent views)**: `currentView` (no persist), `wizardEntryMode` ("setup" | "reconfigure"), `unlockReturnView` ("wizard" | "appShell"), `sidebarOpen` (persisted), `logBuffer` (in-memory).
- **Wizard step form state**: each step manages its own form via React Hook Form + local `useState`:
  - KeystoreStep: `password`, `confirm` (uncontrolled via `register()`, cleared post-submit).
  - WalletsStep: `lastGenerated` (in-session chain→address map), `lastBackupDir`.
  - ApiKeysStep: per-provider form fields (uncontrolled DOM refs for secrets).
  - EmbeddingStep: `baseUrl`, `model`, `dim`, `provider` (regular state).
  - AgentCoreStep: `budget`, `maxIterations`, `conversationWindow` (numeric inputs).
  - ProviderStep: `model` (state), `apiKey` (uncontrolled DOM ref, cleared pre-await).
  - ReviewStep: renders read-only review cards; back-edits re-enter individual steps.
- **Bootstrap orchestrators**: Docker/Compose phase machines (loading → ready/error), migrations progress events, docker install/start mutation state.
- **UnlockScreen**: password ref (uncontrolled), throttle countdown state, pending/error states.
- **TanStack Query (non-persistent domain data)**: `envState`, `available wallets`, `wizard state`, `system health`, `docker status`.

## Boundary crossings

### Inbound (Main → Renderer)

- `window.vex.onboarding.getEnvState()` (IPC query) → TanStack Query → step decides skip-vs-form branching.
- `window.vex.wizard.getState()` (IPC query) → TanStack Query → WizardShell hydrates local step.
- `window.vex.secrets.status()` (IPC query) → WizardShell routing: completed+vault-configured+!unlocked → UnlockScreen.
- `window.vex.database.onProgress(callback)` (event subscription) → Migrations phase state.
- `window.vex.docker.onServiceStatusChange(callback)` (event subscription, optional per bootstrap).

### Outbound (Renderer → Main)

1. **Keystore Step 1**: `window.vex.onboarding.keystoreSet({password, confirm})` → vault creation/lock, `.env` seed → invalidate envState.
2. **Wallets Step 2**: `window.vex.onboarding.walletGenerate({chain})` / `.walletImport({chain, key})` / `.walletRestore({chain, backupPath})` → wallet inventory update.
3. **API Keys Step 3**: `window.vex.onboarding.apiKeysPersist({...keys})` → vault + `.env` write.
4. **Embedding Step 4**: `window.vex.onboarding.embeddingConfigure({baseUrl, model, dim, provider})` → `.env` write → loadEmbeddingConfig per-tool in engine.
5. **Agent Core Step 5**: `window.vex.onboarding.agentCoreConfigure({budget, maxIterations, conversationWindow})` → `.env` write.
6. **Provider Step 6**: `window.vex.onboarding.providerPersist({provider, apiKey, model})` → verify (16-token OpenRouter call, 15s timeout) → vault + `.env` → **resetProvider()** (F1).
7. **Review Step 7**: `window.vex.onboarding.finalize({sentry: bool})` → marks `setup_complete`, routes appShell.
8. **Unlock Screen**: `window.vex.secrets.unlock({password})` → vault decrypt + env inject → routes back to `unlockReturnView`.
9. **Wallet Export**: `window.vex.wallets.exportWallet({walletId, password})` → decrypt + return public address (UI shows address, never key).

**Password field discipline**: uncontrolled `<input type="password">` via `useRef()` or React Hook Form's `register()`. Submitted value is read at IPC call time, ref is cleared **synchronously** (before await) so the secret never parks in React state. No long-lived `setState` of password, no TanStack cache entries.

## File map

### Router & App State

- `vex-app/src/renderer/App.tsx:28–57`: view dispatch map, conditional render by `useUiStore.currentView`.
- `vex-app/src/renderer/stores/uiStore.ts:21–29`: View union type (splash | systemCheck | dockerBootstrap | composeBootstrap | migrations | wizard | unlock | appShell).
- `vex-app/src/renderer/stores/uiStore.ts:103–154`: Zustand store creation, `partialize` whitelist (only sidebarOpen persisted), currentView initialized to "splash".

### Splash & Loader

- `vex-app/src/renderer/features/splash/IntroScreen.tsx:45–76`: onComplete callback, loader duration, focus mgmt on ready, double-click guard.
- `vex-app/src/renderer/features/splash/useLoaderProgress.ts`: timer-driven progress 0→100%, respects `prefers-reduced-motion`.

### System Check

- `vex-app/src/renderer/features/systemCheck/SystemCheck.tsx`: queries `window.vex.system.health()`, renders OS/arch/electron/network status rows, error/loading states.
- `vex-app/src/renderer/features/systemCheck/StepRow.tsx`: per-check row UI (status icon + label + detail).

### Docker Bootstrap

- `vex-app/src/renderer/features/docker/BootstrapPanel.tsx:64–88`: orchestrator; branch decision (loading, ready, daemon stopped, install needed, failure).
- `vex-app/src/renderer/features/docker/BootstrapPanel.tsx:83–87`: `decideBranch()` logic: queries `useDockerStatus()`, `useSystemHealth()`, dispatches 6 branches.
- `vex-app/src/renderer/features/docker/InstallProgress.tsx`: download % + elapsed time for desktop installer.
- `vex-app/src/renderer/features/docker/LicenseNotice.tsx`: Docker license + agree/decline flow (required before install on macOS/Windows).
- `vex-app/src/renderer/features/docker/LinuxManualInstructions.tsx`: fetches + renders OS-specific install commands.
- `vex-app/src/renderer/features/docker/bootstrap/branches/{LoadingBody,ReadyBody,DaemonStoppedBody,DesktopInstallBody,LinuxInstallBody,FailureBody}.tsx`: per-branch UI + action buttons.

### Compose Bootstrap

- `vex-app/src/renderer/features/compose/ComposeBootstrap.tsx:56–114`: calls `window.vex.docker.composeUpAbortable({})`, subscribes to streamed logs, parses service state.
- `vex-app/src/renderer/features/compose/ComposeBootstrap.tsx:64–102`: effect runs migrate, phases: running → ready|error.cancelled|error.port_collision|error.failed|error.unhealthy.
- `vex-app/src/renderer/features/compose/bootstrap/branches/{RunningBody,ReadyBody,PortCollisionBody,UnhealthyBody,FailedBody,CancelledBody}.tsx`: per-phase UI.

### Migrations

- `vex-app/src/renderer/features/database/Migrations.tsx:55–87`: subscribes to `window.vex.database.onProgress()` bus BEFORE invoking `migrate()`.
- `vex-app/src/renderer/features/database/Migrations.tsx:71–85`: progress replay handler; captures applied file history; guards against regression (only update `current` while `kind === "running"`).
- `vex-app/src/renderer/features/database/Migrations.tsx:89–110`: migrate effect, phases: running → noop (auto-advance 500ms) | ready | error.
- `vex-app/src/renderer/features/database/migrations/branches/{RunningBody,NoopBody,ReadyBody,ErrorBody}.tsx`: per-phase UI.

### Wizard Shell & Routing

- `vex-app/src/renderer/features/wizard/WizardShell.tsx:146–205`: top-level wizard router. Initializes local `currentStepId` from `useWizardState()` persisted data.
- `vex-app/src/renderer/features/wizard/WizardShell.tsx:165–205`: effect route logic:
  - If `persisted.completed && wizardEntryMode === "reconfigure"` → show review (back-edit mode).
  - If `persisted.completed && vaultConfigured && !unlocked` → `openUnlock("appShell")`.
  - If `persisted.completed && !vaultConfigured` → restart from keystore (vault wiped scenario).
  - If `persisted.completed && vaultConfigured && unlocked` → `setCurrentView("appShell")`.
  - If mid-wizard and vault locked → `openUnlock("wizard")`.
  - Otherwise → continue from `persisted.currentStepId`.
- `vex-app/src/renderer/features/wizard/WizardShell.tsx:54–88`: `renderStep()` dispatcher, routes step ID to component.
- `vex-app/src/renderer/features/wizard/WizardShell.tsx:287–330`: main render: AnimatePresence wraps step transitions.
- `vex-app/src/renderer/features/wizard/HorizontalStepper.tsx`: visual stepper with completed/current/pending nodes.
- `vex-app/src/renderer/features/wizard/stepper/StepperNode.tsx`: per-step node (icon + loader variant).
- `vex-app/src/renderer/features/wizard/wizard-icons.ts`: WIZARD_STEP_META (icons, titles, descriptions per step).

### Wizard Steps

#### KeystoreStep (Step 1)
- `vex-app/src/renderer/features/wizard/steps/KeystoreStep.tsx:71–100`: form with password + confirm fields, RHF + Zod validation.
- `vex-app/src/renderer/features/wizard/steps/KeystoreStep.tsx:97–98`: dual refs (RHF + manual) for clearing.
- `vex-app/src/renderer/features/wizard/steps/KeystoreStep.tsx:85–86`: `passwordPersisted` flag for skip-badge UX on immediate re-render (codex turn 6 YELLOW #3).
- `vex-app/src/renderer/features/wizard/steps/KeystoreStep.tsx`: onSubmit → `keystoreSet` mutation → clear inputs → advance to wallets.

#### WalletsStep (Step 2)
- `vex-app/src/renderer/features/wizard/steps/WalletsStep.tsx:65–100`: tabs (EVM + Solana), skip-to-continue logic.
- `vex-app/src/renderer/features/wizard/steps/WalletsStep.tsx:78–92`: address source: `lastGenerated` → inventory → legacy `envState`.
- `vex-app/src/renderer/features/wizard/steps/WalletsStep.tsx`: `ChainActions` sub-component per tab (generate/import/restore actions).
- `vex-app/src/renderer/features/wizard/steps/WalletsStep.tsx`: `ExportAllWallets` modal (post-setup wallet export).

#### ApiKeysStep (Step 3)
- `vex-app/src/renderer/features/wizard/steps/ApiKeysStep.tsx`: per-provider (Polymarket, etc.) API key forms.
- `vex-app/src/renderer/features/wizard/steps/ApiKeysStep.tsx`: uncontrolled DOM refs for secrets, pre-submit clear.
- `vex-app/src/renderer/features/wizard/steps/polymarket-auto-setup/`: auto-setup flow (Sudo + confirm modals).

#### EmbeddingStep (Step 4)
- `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx:117–186`: form (baseUrl, model, dim, provider) with validation.
- `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx:76–89`: `narrowDimLockDetails()` safe narrowing (no casts).
- `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx:91–101`: `isValidUrlClient()` mirrors server schema.
- `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx:173`: on success, `configure.mutateAsync()` → advance.

#### AgentCoreStep (Step 5)
- `vex-app/src/renderer/features/wizard/steps/AgentCoreStep.tsx`: numeric fields (budget, maxIterations, conversationWindow).
- `vex-app/src/renderer/features/wizard/steps/agent-core/NumericRow.tsx`: labeled input with range hint.

#### ProviderStep (Step 6)
- `vex-app/src/renderer/features/wizard/steps/ProviderStep.tsx:70–163`: skip card (if configured) or form.
- `vex-app/src/renderer/features/wizard/steps/ProviderStep.tsx:105–163`: `onSubmit` handler:
  - Reads `apiKeyRef.current.value`, `model` state.
  - Validates length + presence.
  - Clears `apiKeyRef.current.value = ""` **before await** (skill §14).
  - Calls `persistProvider(payload)` → main handler (F1 evidence at line 147).
  - On success: `invalidateEnvState()` (cache invalidation) → `advanceToReview()`.
- `vex-app/src/renderer/features/wizard/steps/ProviderStep.tsx:168–224`: skip card summary + reconfigure toggle.
- `vex-app/src/renderer/features/wizard/steps/provider/ModelBrandIcon.tsx`: parses `provider/model` prefix, renders brand SVG.
- `vex-app/src/renderer/features/wizard/steps/provider/error-ui.ts`: maps error codes to UX copy (no raw SDK messages).

#### ReviewStep (Step 7)
- `vex-app/src/renderer/features/wizard/steps/review/ReviewStep.tsx`: renders all prior steps' selections as read-only cards.
- `vex-app/src/renderer/features/wizard/steps/review/cards/{KeystoreCard,WalletsCard,ApiKeysCard,EmbeddingCard,AgentCoreCard,ProviderCard,SummaryCard}.tsx`: per-step summary.
- `vex-app/src/renderer/features/wizard/steps/review/SentryConsentCard.tsx`: toggle sentry opt-in.
- Back-edit: user clicks "Edit" on any card → that step re-renders with `flowMode="back-edit"`.
- Final submit: `finalize({sentry})` → marks onboarding complete → routes appShell.

### Unlock Screen

- `vex-app/src/renderer/features/secrets/UnlockScreen.tsx:74–150`: form with master password input (uncontrolled via ref).
- `vex-app/src/renderer/features/secrets/UnlockScreen.tsx:110–150`: `onSubmit` handler:
  - Reads `passwordRef.current.value`.
  - Validates length.
  - Calls `window.vex.secrets.unlock({password})`.
  - Handles `secrets.unlock_throttled` → countdown banner + setInterval (cleaned up on state change).
  - Clears input on success: `passwordRef.current.value = ""`.
  - Routes to `useUiStore.unlockReturnView` ("wizard" | "appShell").

### Wallet Export

- `vex-app/src/renderer/features/wallets/ExportWalletPicker.tsx`: lists available wallets by chain.
- `vex-app/src/renderer/features/wallets/ExportPrivateKeyModal.tsx`: password entry + confirm → calls `window.vex.wallets.exportWallet({walletId, password})` → displays address (never key in UI).
- `vex-app/src/renderer/features/wallets/ExportLockIcon.tsx`: status icon.

### Common Components

- `vex-app/src/renderer/components/common/PasswordField.tsx:26–54`: forwardRef input, uncontrolled, show/hide toggle.
- `vex-app/src/renderer/components/common/StrengthMeter.tsx`: password strength indicator (entropy-based).
- `vex-app/src/renderer/components/common/AddressDisplay.tsx`: truncate + copy address (no secrets).
- `vex-app/src/renderer/components/onboarding/FooterButtons.tsx`: `ContinueButton`, `RecheckButton` shared across bootstrap screens.

### API Layer (TanStack Query + IPC Wrappers)

- `vex-app/src/renderer/lib/api/onboarding.ts:10–20`: `useEnvState()` query → `window.vex.onboarding.getEnvState()`.
- `vex-app/src/renderer/lib/api/wizard.ts`: `useWizardState()`, `useKeystoreSet()`, `useStepAdvance()` queries/mutations.
- `vex-app/src/renderer/lib/api/provider.ts:28–41`: `persistProvider()` plain async (no mutation — secret handling), `useInvalidateEnvStateAfterProviderWrite()` helper.
- `vex-app/src/renderer/lib/api/api-keys.ts`: `useApiKeysPersist()` mutation.
- `vex-app/src/renderer/lib/api/embedding.ts`: `useEmbeddingConfigure()` mutation.
- `vex-app/src/renderer/lib/api/agent-core.ts`: `useAgentCoreConfigure()` mutation.
- `vex-app/src/renderer/lib/api/docker.ts`: `useDockerStatus()`, `useDockerInstall()`, `useDockerStart()` queries/mutations.
- `vex-app/src/renderer/lib/api/wallets.ts`: `useWalletGenerate()`, `useWalletImport()`, `useWalletRestore()` mutations.
- `vex-app/src/renderer/lib/api/wallet-inventory.ts`: `useAvailableWallets()` query.
- `vex-app/src/renderer/lib/api/finalize.ts`: `useFinalize()` mutation.

## Key types & invariants

### Routing Determinism (App.tsx)

View routing is **deterministic** from preload state queries:
- `useUiStore.currentView` is the single source of truth.
- All transitions are explicit `setCurrentView()` calls (no side-effect routing).
- WizardShell routing (lines 165–205) queries vault status once on mount and routes based on `persisted.completed`, `vaultConfigured`, `unlocked`, `wizardEntryMode`.

### Unlock Routing Invariant (WizardShell:174–196)

If setup is complete but vault is locked, the wizard routes to UnlockScreen with `unlockReturnView` set appropriately:
- Mid-wizard (persisted.currentStepId !== "keystore") → `unlockReturnView: "wizard"` → back to same step.
- Setup complete (persisted.completed) → `unlockReturnView: "appShell"` → app shell entry.

### Password Field Discipline

**Rule**: passwords must never persist in React state.

- Uncontrolled refs via `useRef()` or React Hook Form `register()`.
- Value read at IPC call time.
- Ref cleared **synchronously before await**: `if (ref.current) ref.current.value = ""`.
- No `setState`, no TanStack mutations, no Zustand persist.
- Examples: KeystoreStep (line 97–98), ProviderStep (line 139–141), UnlockScreen (line 145).

### Provider Step F1 Evidence (ProviderStep.tsx + main handler)

Provider step's submit flow:
1. Renderer ProviderStep (line 147): `persistProvider(payload)` → `window.vex.onboarding.providerPersist(input)`.
2. Main handler (`vex-app/src/main/ipc/onboarding/provider.ts`):
   - Line 46–56: verify OpenRouter connection (16-token call, 15s timeout).
   - Line 66: wrap `writeProvider()` in `withEnvWriteLock()`.
   - **Line 69**: `loadProviderDotenv({ overwrite: true })` — reload `.env` into `process.env`.
   - **Line 70–73**: `resetProvider()` import + call — **F1 trigger**. This resets the cached provider in the inference registry so the next `resolveProvider()` rebuild uses the new model.
3. Renderer (line 155): invalidate `envState` cache on success.

This implements the global model/provider pattern (ADR-0001): the model is NOT per-session, it is global (stored in `.env`, reset in engine on write).

### Env State & Writer Atomicity

Each wizard step's submit:
1. Renderer calls dedicated writer via IPC (keystoreSet, apiKeysPersist, embeddingConfigure, agentCoreConfigure, providerPersist).
2. Main handler:
   - Validates input.
   - Secrets (if any) are stored in the encrypted vault.
   - Non-secret values written to `.env`.
   - `.env` write happens inside `withEnvWriteLock()` to prevent concurrent writes.
   - On success, `loadProviderDotenv({ overwrite: true })` reloads the process.env.
3. Renderer invalidates `envState` query cache, next step sees fresh values.

### Wallets Step Inventory Model

Wallets step (lines 78–92) sources the address to display:
1. In-session `lastGenerated[chain]` (user just generated).
2. Wallet inventory (`useAvailableWallets()` query) — primary source for multi-wallet support.
3. Legacy fallback: `envState.walletAddresses[chain]` (M1 single-wallet era).

Private keys never enter React state. Generate/import/restore are driven by `ChainActions` which call the main writer directly and update inventory on success.

### Review Step Back-Edit Flow

ReviewStep renders all prior selections as read-only cards. User clicks "Edit" → step re-enters with `flowMode: "back-edit"`. In back-edit:
- No persistent state advance (local nav only).
- Submit button text changes ("Verify and return to review" vs "Verify and save").
- Step advance still calls the writer, but doesn't persist wizard state.
- Back to review, card updates from cache invalidation.

### Embedding Step Dim-Lock Special Case

When the user tries to reconfigure embedding dim and it differs from an existing pgvector table:
- Server returns `embedding.dim_locked` with `details: {existingRowCount, targetDim}`.
- Renderer safely narrows via `narrowDimLockDetails()` (no `as` casts, checks `in` operator).
- Shows a warning card with the mismatch details + guidance.
- Form remains filled so user can decide to back out or accept the constraint.

### Password Throttle (UnlockScreen)

Failed unlock attempts trigger throttle:
- Server returns `secrets.unlock_throttled` with `retryAfterMs`.
- Renderer sets a `ThrottleState` with `retryAtMs = Date.now() + retryAfterMs`.
- `setInterval` counts down (cleaned up on every state change to prevent leaks).
- Inputs disabled until countdown expires.
- Shows inline alert with remaining seconds.

## Capabilities (stable IDs)

### Splash
- `CAP-vexapp-onboarding-ui-splash`: render intro screen + loader + begin button.

### System Check
- `CAP-vexapp-onboarding-ui-systemcheck-run`: query OS/arch/electron/network, display rows.

### Docker Bootstrap
- `CAP-vexapp-onboarding-ui-docker-detect`: query docker status, decide branch (loading|ready|daemon-stopped|install|failure).
- `CAP-vexapp-onboarding-ui-docker-install`: prompt license notice, download installer, track progress.
- `CAP-vexapp-onboarding-ui-docker-start`: call docker start, poll status.

### Compose Bootstrap
- `CAP-vexapp-onboarding-ui-compose-render`: render running/ready/error/port-collision/unhealthy branches.
- `CAP-vexapp-onboarding-ui-compose-up`: call `composeUpAbortable`, subscribe to log stream, parse service state.
- `CAP-vexapp-onboarding-ui-compose-health`: monitor per-service health from parsed logs (cosmetic; orchestrator phase driven by IPC result).

### Migrations
- `CAP-vexapp-onboarding-ui-migrations-run`: call `database.migrate()`, subscribe to progress bus.
- `CAP-vexapp-onboarding-ui-migrations-status`: render running/noop/ready/error branches, auto-advance noop, retry error.

### Wizard
- `CAP-vexapp-onboarding-ui-wizard-step-keystore-submit`: validate password + confirm, call `keystoreSet`, advance.
- `CAP-vexapp-onboarding-ui-wizard-step-wallets-submit`: generate/import/restore wallets per chain, check both ready, advance.
- `CAP-vexapp-onboarding-ui-wizard-step-api-keys-submit`: validate + persist API keys per provider.
- `CAP-vexapp-onboarding-ui-wizard-step-embedding-submit`: validate URL + dim, call `embeddingConfigure`, handle dim-lock special case.
- `CAP-vexapp-onboarding-ui-wizard-step-agent-core-submit`: validate budget/iterations/window, call `agentCoreConfigure`.
- `CAP-vexapp-onboarding-ui-wizard-step-provider-submit`: validate API key + model, call `providerPersist`, trigger F1.
- `CAP-vexapp-onboarding-ui-wizard-step-review-submit`: render all prior selections, toggle sentry, call `finalize`, route appShell.
- `CAP-vexapp-onboarding-ui-polymarket-auto-setup`: Polymarket Sudo modal + confirm flow (Step 3 sub-feature).

### Unlock
- `CAP-vexapp-onboarding-ui-unlock-submit`: read password from uncontrolled ref, call `secrets.unlock`, handle throttle countdown.

### Wallet Export (Post-Setup)
- `CAP-vexapp-onboarding-ui-wallets-export-pick`: list available wallets by chain.
- `CAP-vexapp-onboarding-ui-wallets-export-modal`: password entry + decrypt + display address.

## Public API (consumed by)

**Preload bridge methods (vex-app/src/preload/vex-bridge.ts)** exposed on `window.vex.*`:

```
window.vex.onboarding.getEnvState() → Result<EnvState>
window.vex.onboarding.keystoreSet({password, confirm}) → Result<KeystoreSetResult>
window.vex.onboarding.walletGenerate({chain}) → Result<...>
window.vex.onboarding.walletImport({chain, key, ...}) → Result<...>
window.vex.onboarding.walletRestore({chain, backupPath}) → Result<...>
window.vex.onboarding.apiKeysPersist({...}) → Result<...>
window.vex.onboarding.embeddingConfigure({baseUrl, model, dim, provider}) → Result<...>
window.vex.onboarding.agentCoreConfigure({budget, maxIterations, conversationWindow}) → Result<...>
window.vex.onboarding.providerPersist({provider, apiKey, model}) → Result<ProviderPersistResult>
window.vex.onboarding.finalize({sentry}) → Result<FinalizeResult>

window.vex.wizard.getState() → Result<WizardState>
window.vex.wizard.setWizardState({...}) → Result<WizardStateResult>

window.vex.secrets.status() → Result<{vaultConfigured, unlocked}>
window.vex.secrets.unlock({password}) → Result<...>

window.vex.system.health() → Result<HealthReport>

window.vex.docker.dockerStatus() → Result<DockerStatus>
window.vex.docker.dockerInstall({method}) → Result<...>
window.vex.docker.dockerStart() → Result<...>
window.vex.docker.composeUpAbortable({}) → {promise: Promise<Result<...>>, cancel: () => void}
window.vex.docker.linuxManualInstructions() → Result<string>

window.vex.database.migrate() → Result<...>
window.vex.database.onProgress(callback) → unsubscribe function

window.vex.wallets.exportWallet({walletId, password}) → Result<{address: string}>

window.vex.capabilities.get() → Result<Capabilities>
```

**Result type**: `{ok: true, data: T} | {ok: false, error: {code: string, message: string, ...}}`

## Internal flow

### Splash → SystemCheck → DockerBootstrap

```
App.tsx:28–57 (view dispatch)
  → IntroScreen:45–76 (render, loader progress)
    → onComplete() calls handleSplashComplete
      → setCurrentView("systemCheck")
  → SystemCheck (query system.health)
    → renders OS/arch/electron/network
    → Continue button → setCurrentView("dockerBootstrap")
  → BootstrapPanel (docker orchestrator)
    → useDockerStatus query, decideBranch
    → render 6 branches (loading | ready | daemon-stopped | install | failure)
    → Continue (ready) → setCurrentView("composeBootstrap")
```

### DockerBootstrap → ComposeBootstrap → Migrations

```
BootstrapPanel
  → Continue button → setCurrentView("composeBootstrap")
  → ComposeBootstrap:64–114
    → invokes composeUpAbortable, subscribes to streamed logs
    → parseComposeLog per-service state (cosmetic only)
    → phases: running → ready | error.*
    → Continue (ready) → setCurrentView("migrations")
  → Migrations:55–87
    → subscribes to database.onProgress BEFORE calling migrate()
    → phases: running → noop (auto-advance 500ms) | ready | error
    → invalidate envState (migrate seeds embedding defaults)
    → Continue (ready) → setCurrentView("wizard") or openWizard("setup")
```

### Wizard: 7 Steps End-to-End

```
WizardShell:146–205 (router)
  → initialize currentStepId from persisted wizard state
  → route logic checks: completed? reconfigure? vault locked?
    → if incomplete: show step dispatcher
    → if completed + reconfigure: show review (back-edit)
    → if completed + locked: openUnlock("appShell")
    → if completed + unlocked: setCurrentView("appShell")

Step 1: KeystoreStep:71–100
  → form (password + confirm), RHF + Zod validation
  → onSubmit: keystoreSet → advance("wallets")

Step 2: WalletsStep:65–100
  → tabs (EVM + Solana), generate/import/restore per chain
  → skip-to-continue if both ready
  → onSubmit advance("apiKeys")

Step 3: ApiKeysStep
  → per-provider forms (Polymarket, etc.)
  → polymarket-auto-setup sub-feature
  → advance("embedding")

Step 4: EmbeddingStep:117–186
  → form (baseUrl, model, dim, provider)
  → validation: URL client-side + server-side
  → handle dim-lock special case
  → advance("agentCore")

Step 5: AgentCoreStep
  → numeric inputs (budget, maxIterations, conversationWindow)
  → advance("provider")

Step 6: ProviderStep:70–163
  → skip card (if configured) or form
  → submit: read apiKey + model, clear ref, call persistProvider
  → persistProvider triggers F1 (resetProvider in engine)
  → invalidate envState, advance("review")

Step 7: ReviewStep
  → render all prior selections as read-only cards
  → toggle sentry consent
  → submit: finalize({sentry}) → setCurrentView("appShell")
  → if user edits: re-enter step with flowMode="back-edit"
```

### Post-Setup: Unlock → AppShell

```
App.tsx view dispatch (appShell)
  → AppShell:... (runtime UI)

OR if vault locked after restart:
  → WizardShell routing:174–196
    → query secrets.status → vaultConfigured && !unlocked
    → openUnlock("appShell") → setCurrentView("unlock")
  → UnlockScreen:74–150
    → form (master password)
    → onSubmit: read password, call secrets.unlock, clear ref
    → on success: setCurrentView(unlockReturnView) → "appShell"
```

## Dependencies

- **React**: hooks (useState, useEffect, useRef, useCallback, useContext).
- **react-hook-form**: form state management with uncontrolled fields.
- **zod**: schema validation (imported from @shared/schemas).
- **@tanstack/react-query**: TanStack Query for IPC queries/mutations.
- **zustand**: UI state store (currentView, wizardEntryMode, unlockReturnView).
- **motion/react**: framer motion for transitions (splash loader, wizard step animations).
- **shadcn/ui**: UI components (Button, Input, Label, Tabs, etc.).
- **@hugeicons/react** + **@hugeicons/core-free-icons**: icon library.
- **@thesvg/react**: brand SVG icons (Docker, Ethereum, Solana, model brands, etc.).
- **Electron preload bridge**: `window.vex.*` IPC contract (defined in preload, implemented in main).

## Cross-references

- **Preload contract**: `vex-app/src/preload/vex-bridge.ts`, `vex-app/src/preload/expose-bridge.ts` — bridge registration.
- **Main handlers**: `vex-app/src/main/ipc/onboarding/` — keystoreSet, walletGenerate, apiKeysPersist, embeddingConfigure, agentCoreConfigure, providerPersist, finalize.
- **Secrets/vault**: `vex-app/src/main/secrets/vault.ts`, `vex-app/src/main/secrets/session.ts` — encryption/decryption.
- **Env writers**: `vex-app/src/main/onboarding/*-writer.ts` — atomicity via `withEnvWriteLock()`.
- **Provider registry**: `src/vex-agent/inference/registry.ts` — `resetProvider()` F1 trigger.
- **Docker/Compose**: `vex-app/src/main/docker/` — status probes, install, compose orchestration.
- **Database**: `src/vex-agent/data/db.ts`, migrations — schema setup.
- **Wallet generation**: `src/vex-agent/wallet/` — EVMWallet, SolanaWallet.

## Refresh triggers

Stale when:
- `vex-app/src/main/ipc/onboarding/` files change (IPC contracts).
- `vex-app/src/main/onboarding/*-writer.ts` files change (writer side effects).
- `vex-app/src/shared/schemas/wizard.ts` schema changes (step order, validation).
- `vex-app/src/shared/schemas/secrets.ts` schema changes (password rules).
- `src/vex-agent/inference/registry.ts resetProvider()` contract changes (F1).

## Open questions

1. **Password cache behavior**: Confirm no passwords are cached by TanStack Query, Zustand persist, or Electron Cache. Check for any `useMutation` or Query that might park a secret.
2. **Provider test/list models**: ProviderStep has a commented "Test" button path (mentioned in codex findings). Confirm if `providerTest` / `providerListModels` channels are bridged or still unbridged (Round 2 finding).
3. **Embedding legacy port**: Does EmbeddingStep ever reference `:12434` legacy port in the UI or schema? Confirm current port defaults.
4. **Polymarket private key**: Does polymarket-auto-setup write any private key to renderer state or Zustand? Verify key stays in main process only.
5. **WizardShell routing edge case (line 174–196)**: Full state machine logic confirmed, but edge case — what if `secrets.status()` call fails during routing? Currently no fallback shown; confirm this is safe (likely retried by query).
6. **Unlock throttle countdown**: Confirm the `setInterval` in UnlockScreen is fully cleaned up on unmount (return cleanup function from useEffect at line 85–101).

---

**Module type**: Renderer UI orchestration + form layer.  
**Maintainer category**: Onboarding/setup UX.  
**Security-sensitive**: Yes — vault, password handling, secrets in IPC, wallet generation.  
**Last reviewed**: 2026-05-28.
