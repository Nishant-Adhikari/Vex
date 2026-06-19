### 2.19 Work Unit 19 — Sync, portfolio, projections, captures

#### Files & LOC

- `src/vex-agent/sync/worker.ts` 202 LOC
- `src/vex-agent/sync/executor.ts` 91 LOC
- `src/vex-agent/sync/synthetic-capture.ts` 103 LOC
- `src/vex-agent/sync/prediction-settlement-sync.ts` 292 LOC
- `src/vex-agent/sync/**`
  - area total from slice: 18 files, 2,226 LOC
- `src/vex-agent/db/repos/balances.ts` 366 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/repos/messages.ts` 374 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/repos/{transactions,open-positions,lp-events,pnl-*}.ts`
- `src/vex-agent/tools/protocols/capture-pipeline.ts` 122 LOC
- `src/vex-agent/tools/protocols/capture-validator.ts` 149 LOC

#### Responsibility

- Seed and execute sync jobs.
- Balance/activity/position/prediction settlement sync.
- Refresh projections/mark-to-market.
- Write synthetic captures.
- Feed portfolio/accounting views from protocol execution captures.

#### Mechanisms/patterns

- Long-lived sync executor with `stop()` cleanup.
- Worker claims pending runs and groups by sync type.
- Projection refresh after sync.
- Synthetic protocol executions feed capture/projection pipeline.
- DB repos for balances, transactions, positions, PnL.

#### Dependencies & data-flow

Entry points:

- Main starts sync worker during app boot.
- Runtime/mission/protocol captures trigger projection updates.
- Sync worker calls protocol/client APIs and DB repos.

Imports/dependencies:

- DB sync repos.
- Protocol clients.
- Capture pipeline.
- Wallet/proxy identifiers for account scoping.

Side effects:

- Long-lived timers.
- External API/RPC calls.
- DB writes for balances, activity, projections, synthetic captures.
- Logs warnings around wallet/proxy identifiers.

#### Security surface

- Wallet/proxy identifiers and portfolio data are sensitive.
- Synthetic captures can affect audit/projection state.
- Stale `running` rows can stall sync after crashes.
- Logs/support must redact wallet/proxy identifiers where policy requires.

#### Hotspots

- No stale-running reset was found in inspected sync path.
- Synthetic capture bypass/interaction with mutation matrix needs audit.
- Prediction settlement sync logs wallet/proxy identifiers in warning paths.
- Long-lived timers and streams need quit/update cleanup proof.

`console.*` density:

- Sync should use structured logger; direct console hits need classification.

#### Tests

Covered:

- Sync/projection tests under `src/__tests__/vex-agent/sync/**`.
- Capture/protocol execution tests.
- DB repo tests.

Not covered / unclear:

- Crash/restart stale-running recovery.
- Complete cleanup across app quit/update restart.
- Synthetic capture provenance and audit semantics.
- Redaction of wallet/proxy identifiers in all logs/support bundles.

#### Open risks/smells

- Add stale-running recovery tests/logic if absent.
- Audit synthetic captures against mutation matrix.
- Review projection integrity under partial sync failures.
- Ensure sync worker stop is always called before DB shutdown.

