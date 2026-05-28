---
id: FLOW-onboarding-config-write
kind: flow
paths:
  - vex-app/src/renderer/features/wizard/steps/ProviderStep.tsx
  - vex-app/src/renderer/lib/api/provider.ts
  - vex-app/src/preload/shell/onboarding.ts
  - vex-app/src/main/ipc/onboarding/provider.ts
  - vex-app/src/main/onboarding/provider-writer.ts
  - vex-app/src/main/onboarding/env-write-mutex.ts
  - src/lib/runtime-env.ts
  - src/providers/env-resolution.ts
  - src/vex-agent/inference/registry.ts
  - vex-app/src/main/index.ts
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - vex-app/src/renderer/features/wizard/**
  - vex-app/src/renderer/lib/api/{provider,api-keys,wizard,embedding,agent-core,onboarding}.ts
  - vex-app/src/preload/shell/onboarding.ts
  - vex-app/src/main/ipc/onboarding/**
  - vex-app/src/main/onboarding/**
  - src/lib/runtime-env.ts
  - src/providers/env-resolution.ts
  - src/utils/dotenv.ts
  - src/vex-agent/inference/registry.ts
  - vex-app/src/main/index.ts
related:
  - module.vex-app.renderer-onboarding-bootstrap-secrets
  - module.vex-app.main-docker-compose-onboarding
  - module.vex-app.main-secrets-wallet-support
  - module.src-root.lib-env-config
  - module.src-root.lib-vault-secrets
  - module.vex-agent.inference
  - fix-plan.F1
  - ADR-0001-global-model-session-wallet
---

# FLOW-onboarding-config-write: Wizard step → main writer → withEnvWriteLock → reload + resetProvider

## Trigger
User submits a wizard step that writes either non-secret `.env` config or vault secrets. The provider step is the F1 anchor (it triggers the env reload + `resetProvider()`); other writer steps share the same mutex but only reload as needed.

## Preconditions
- Setup not yet finalized (or reconfigure entry).
- Renderer route is on the wizard step.
- For secret-bearing steps (api-keys), vault is set up (after keystore step).

## Steps (canonical provider step)

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|---------------|
| 1 | renderer `ProviderStep.tsx onSubmit` | `usePersistProvider()` (lib/api/provider.ts) | local form state | none | RHF + Zod validation rejects bad input |
| 2 | hook | `window.vex.onboarding.persistProvider({provider, model, apiKey?})` | clears `apiKeyRef.current.value = ""` BEFORE the await (password discipline) | preload envelope | preload zod input rejection |
| 3 | preload `shell/onboarding.ts persistProvider` | `invokeWithSchema(CH.onboarding.persistProvider)` | none | request | invalid envelope |
| 4 | main `vex-app/src/main/ipc/onboarding/provider.ts` via `registerHandler` | trusted-sender check + input zod + acquire `withEnvWriteLock()` | env mutex held | none | mutex queue (serialized writes) |
| 5 | INSIDE the lock: `writeProvider()` writes non-secret keys (`AGENT_PROVIDER`, `AGENT_MODEL`) to `.env`, vault writes `OPENROUTER_API_KEY` to `secrets.vault.json` | atomic file write (temp + rename) | `.env` and/or vault updated | partial write → atomic rename guarantees consistent state |
| 6 | INSIDE the lock: dynamic-import `loadProviderDotenv` from `src/lib/runtime-env.ts` → calls `loadProviderDotenv({overwrite: true})` from `src/providers/env-resolution.ts` → `src/utils/dotenv.ts:46` honors `overwrite` flag and re-injects `.env` into `process.env` | `process.env` keys reset to new values | none | corrupt `.env` → throw, mutex releases on error |
| 7 | INSIDE the lock: dynamic-import `{ resetProvider }` from `@vex-agent/inference/registry.js` and call `resetProvider()` (F1 fix) | cached singleton in inference registry cleared | none | none |
| 8 | release mutex; return IPC result with envState snapshot | renderer invalidates `envState` and `wizardState` queries | TanStack cache refresh | none |
| 9 | renderer advances wizard to next step (or to review if last) | route change via `uiStore.setCurrentView` | local | none |

## Boot-time analogue
On every app start, `vex-app/src/main/index.ts:116 loadProviderDotenv()` runs BEFORE `registerAllIpcHandlers`/workers. This is the other half of F1: any change to `.env` between sessions is read fresh on boot, and workers/IPC never see stale values.

## Variations (other wizard writers)
- **Keystore step.** Renderer collects password via uncontrolled ref, clears synchronously, calls `keystore-writer.ts`. Vault is initialized; master password lives in memory only.
- **Wallets step.** `wallets-runner.ts` orchestrates generate/import/restore; keystore + Solana-keystore written; addresses surfaced via inventory.
- **API keys step.** `api-keys-writer.ts` writes vault entries (Polymarket, Tavily, Jupiter, Rettiwt). No `.env` non-secret reload required (those keys are vault-side); main reads from vault on demand.
- **Embedding step.** `embedding-writer.ts` writes `EMBEDDING_*` to `.env`; reload happens here too (so engine sees new endpoint/dim/alias).
- **Agent-core step.** `agent-core-writer.ts` writes numeric `AGENT_*` keys (context limit, max output tokens, temperature, subagent caps). Reload + resetProvider conservatively follows the same pattern.
- **Finalize.** `finalize.ts` writes `.setup-complete` marker after all prior steps succeed; subsequent app boots route to appShell (or unlock if vault locked).

## Invariants
- `withEnvWriteLock()` serializes all `.env` writes (`env-write-mutex.ts`). Concurrent wizard steps in two windows / IPC retries cannot trample.
- Provider write MUST do `writeProvider()` → `loadProviderDotenv({overwrite: true})` → `resetProvider()` in that order, ALL inside the mutex.
- `resetProvider()` is the only way to invalidate the inference registry singleton; without it, the engine keeps the previous provider instance and "looks" unconfigured / wrong-model.
- Passwords / API keys never live in React state, Zustand persist, or TanStack cache — uncontrolled refs only; cleared synchronously BEFORE the await.
- Vault `OPENROUTER_API_KEY` lives in vault; `.env` carries `AGENT_PROVIDER`/`AGENT_MODEL` (non-secret).
- ADR-0001: provider config is GLOBAL; no per-session writes.
- F1 boot ordering: `loadProviderDotenv` MUST run before `registerAllIpcHandlers`, `setupCompactWorker`, `setupWakeWorker` in `index.ts`.

## Related modules / capabilities
- `module.vex-app.renderer-onboarding-bootstrap-secrets` — `CAP-vexapp-onboarding-ui-wizard-step-provider-submit` and siblings
- `module.vex-app.main-docker-compose-onboarding` — `CAP-vexapp-onboarding-write-provider`, `CAP-vexapp-onboarding-write-env`, `CAP-vexapp-onboarding-finalize`
- `module.vex-app.main-secrets-wallet-support` — vault write contract (called by api-keys-writer)
- `module.src-root.lib-env-config` — `loadProviderDotenv`, `src/utils/dotenv.ts overwrite` flag, `src/lib/runtime-env.ts` facade
- `module.vex-agent.inference` — `resetProvider()`; F1 reset call site
- `fix-plan.F1` — full RCA + Codex-reviewed plan

## Known failure modes
- **OpenRouter test fails post-write.** Round-2 finding: `CH.onboarding.providerListModels` and `CH.onboarding.providerTest` are reserved/unbridged today; the wizard's "Test" button is intentionally deferred. Persist still works without a live API check.
- **Vault locked during reconfigure.** Provider step requires the vault to be unlockable so the OpenRouter key can be written; if user is mid-wizard and vault locked, `WizardShell.tsx:174-199` routes to UnlockScreen with `unlockReturnView: "wizard"` first.
- **Corrupt `.env` rollback.** Atomic temp+rename in `provider-writer.ts`. Failure mid-write leaves the previous `.env` intact; subsequent reload reads previous values; user sees "Save failed" UX and retries.
- **resetProvider() not called.** Pre-F1 bug — provider singleton stays stale even after correct `.env` write. F1 fix ensures this cannot happen for provider step.
