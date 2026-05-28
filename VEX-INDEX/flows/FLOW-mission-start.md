---
id: FLOW-mission-start
kind: flow
paths:
  - vex-app/src/renderer/features/appShell/slash/dispatch.ts
  - vex-app/src/renderer/features/appShell/MissionContractCard.tsx
  - vex-app/src/renderer/lib/api/mission.ts
  - vex-app/src/preload/agent/mission.ts
  - vex-app/src/main/ipc/mission/start.ts
  - vex-app/src/main/ipc/mission/accept-contract.ts
  - vex-app/src/main/ipc/mission/update-draft.ts
  - vex-app/src/main/ipc/mission/_engine-dispatch.ts
  - src/vex-agent/engine/mission/**
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - vex-app/src/renderer/features/appShell/slash/**
  - vex-app/src/renderer/features/appShell/MissionContractCard.tsx
  - vex-app/src/renderer/features/appShell/MissionContractCardSections.tsx
  - vex-app/src/renderer/lib/api/mission.ts
  - vex-app/src/preload/agent/mission.ts
  - vex-app/src/main/ipc/mission/**
  - vex-app/src/shared/schemas/mission/**
  - src/vex-agent/engine/mission/**
  - src/vex-agent/engine/core/runner/**
related:
  - module.vex-app.renderer-appshell-runtime
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.main-agent-bridge
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-agent.engine-mission
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-wake-subagents-prompts
  - ADR-0001-global-model-session-wallet
---

# FLOW-mission-start: Mission contract → ready → start → background runner

## Trigger
User invokes `/mission start <prompt>` in `SessionComposer`, or interacts with the mission contract card to accept/edit a draft and start. Session mode is `mission` (FULL AUTONOMOUS).

## Preconditions
- Setup complete; vault unlocked; provider ready (same gates as FLOW-chat-turn).
- Session exists with mode `mission`.
- Mission lifecycle states: draft → ready → running → completed/failed/cancelled. A session may also have an active wake-paused run.

## Steps

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|---------------|
| 1 | `vex-app/src/renderer/features/appShell/slash/dispatch.ts` slash handler | `useMissionStart()` (lib/api/mission.ts) | composer hides input pending result | none | unknown slash form |
| 2 | renderer `useMissionStart` | `window.vex.mission.start({sessionId, prompt, correlationId})` | none | request envelope | preload zod input rejection |
| 3 | `vex-app/src/preload/agent/mission.ts start` | `invokeWithSchema(CH.mission.start, env, missionStartOutputSchema)` | binds AbortController to correlationId | request | invalid envelope shape |
| 4 | main `vex-app/src/main/ipc/mission/start.ts` via `registerHandler(CH.mission.start)` | trusted-sender + input zod + `_ensure-engine-db-url`, then `_engine-dispatch.ts` dynamic import | engine `prepareMissionStart` creates draft (or accepts existing) | row `missions` (status `draft`); transcript may receive contract preview | `feature_unavailable` if engine not bootable; provider unavailable; lease conflict |
| 5 | engine `src/vex-agent/engine/mission/prepare-mission-start.ts` (or equivalent) | builds mission contract, persists, returns `{missionId, contract}` synchronously | engine commits durable row before IPC returns | `missions` row insert | duplicate active mission per session → error |
| 6 | IPC returns synchronously; renderer `MissionContractCard` becomes visible above transcript | renderer fetches contract via `useMissionDraft` / `useMissionDiff` | TanStack Query cache populated | none | none |
| 7 | user edits contract (optional) | `window.vex.mission.updateDraft({missionId, patch})` → main `mission/update-draft.ts` | engine `patchMissionDraft` updates row | row update; diff event | invalid patch shape |
| 8 | user accepts | `window.vex.mission.acceptContract({missionId})` → main `mission/accept-contract.ts` | engine `commitMission` flips draft → ready | row status `ready`; lease prepared | already-running mission |
| 9 | accept handler dispatches fire-and-forget runner | `engine/core/runner/agent.ts processAgentTurn` or mission runner files (`prepare/resume/finalize/recover`) | main returns to IPC; background runner picks up | row status `running`; transcript appends operator instructions + first turn | runner crash → status `paused_error` |
| 10 | mission runner runs `runTurnLoop` repeatedly with self-defer via `loop_defer` (see FLOW-wake-resume) | each tool/turn updates transcript via `appendMessage` | bus events propagate to bridges → BrowserWindow → renderer invalidations | `messages`, `runs`, `loop_wake_requests` (when deferred) | stop conditions trigger finalize; restricted approval pauses (see FLOW-approval-restricted) |
| 11 | mission completes / fails / cancelled / stopped by `/mission stop` | engine finalize → release lease | `runs.status='completed'/'failed'/'cancelled'/'stopped'`; mission status `completed`/`failed`/`cancelled` | row updates; final transcript event | none |

## Invariants
- Mission contract is durably persisted before IPC returns; renderer can rely on the contract id existing.
- Only one active mission run per session (lease + status invariants enforced by engine).
- Mission runner is fire-and-forget from main's perspective; main does NOT await completion.
- Mode is `mission` → FULL AUTONOMOUS, but tool gating still applies (restricted/mutating triggers approval gate; see FLOW-approval-restricted).
- ADR-0001: mission still uses the global model; no `sessions.model_id` lookup.
- `accept-contract` and `start` go through the same `_engine-dispatch.ts` dynamic-import seam; never import `@vex-agent` at module-load time in main.

## Related modules / capabilities
- `module.vex-app.main-ipc-engine-orchestration` — `CAP-vexapp-mission-start`, `CAP-vexapp-mission-accept-contract`, `CAP-vexapp-mission-update-draft`, `CAP-vexapp-mission-stop`, `CAP-vexapp-mission-restore`, `CAP-vexapp-mission-renew`, `CAP-vexapp-mission-rewind`, `CAP-vexapp-mission-continue`, `CAP-vexapp-mission-recover`
- `module.vex-app.renderer-appshell-runtime` — `CAP-vexapp-ui-session-mission-card`, `CAP-vexapp-ui-slash-dispatch-mission-start`
- `module.vex-agent.engine-mission` — `CAP-engine-mission-prepare`, `CAP-engine-mission-commit`, `CAP-engine-mission-finalize`
- `module.vex-agent.engine-runner` — `CAP-engine-process-agent-turn`
- `module.vex-agent.engine-wake-subagents-prompts` — wake handoff when mission self-defers

## Known failure modes
- **Duplicate active mission.** Engine enforces one active mission per session; a second `start` while another runs returns a conflict error.
- **Provider unavailable mid-run.** Same as FLOW-chat-turn step 11 — turn fails, run pauses with `paused_error`. `/mission continue` resumes after fix.
- **Crash recovery.** If main crashes mid-run, `engine/core/runner/recover-prepare.ts` (or equivalent) walks unfinished runs on next boot. Wake worker will not claim a `paused_wake` row until `isWakeProviderConfigured()` is true.
- **abortMissionRun / retryActiveMissionRun / stopActiveMissionForEdit** flagged by Round 1 as having no IPC handler — confirm in module doc Open questions.
