# Batch P1-D — Tool-batch + vault + docker-probe + wallet-export splits (A-018, A-025, A-026, A-027)

**Mode:** development. Façade-preserving structural splits, ZERO behavior change. Nested-subdir convention.
**Baseline:** `HEAD == origin/main == d85b000`. Working tree clean.
**Execution:** 4 Opus-4.8 subagents in parallel, file-disjoint, nested dirs.

## Parallel-safety
Distinct domains/dirs: `core/turn-loop-tool-batch/`, `lib/local-secret-vault/`, `main/docker/probe/`, `main/ipc/wallet-export/`. Cross-imports resolve through façades. **No importer modified.**
**Cross-project:** A-025 (src/lib, @vex-lib) + A-026/A-027 (vex-app) + A-018 (src). Verify root `tsc` + `vex-app lint` + both vitest.

## B-000 obligations
Façade re-exports identical symbols + `*-surface.test.ts`; move VERBATIM; never log secrets (A-025/A-027); no module imports its own façade; single-source shared private helpers; preserve file mode.

---

### A-018 — `src/vex-agent/engine/core/turn-loop-tool-batch.ts` (413 LOC)
**Façade exports (exact):** `StopPayload`, `ToolBatchOutcome`, `processTurnToolBatch`.
**New modules under `core/turn-loop-tool-batch/`:** `outcome.ts` (StopPayload, ToolBatchOutcome discriminated union incl. internal `engine_stop`/`compact_committed` kinds) · `execute.ts` (tool execution loop) · `approval-stop.ts` (approval-enqueue transaction + approval-required stop path) · `results.ts` (result aggregation). Keep `processTurnToolBatch` orchestrator in the façade.
**CRITICAL:** preserve the approval-enqueue transaction coupling and the exact BatchOutcome semantics (engine_stop / compact_committed / approval_required); no reordered side effects.
**Importer (untouched):** `engine/core/turn-loop.ts` (façade). **Guard:** `turn-loop.test.ts` (covers processTurnToolBatch via runTurnLoop), `turn-loop-overflow.test.ts`, `turn-loop-defer.test.ts`.

---

### A-025 — `src/lib/local-secret-vault.ts` (351 LOC) — SECURITY-CRITICAL (crypto), @vex-lib, 13 importers
**Façade exports (exact, 13):** `CURRENT_KDF_PARAMS`, `LocalSecretVaultOptions`, `LocalSecretVaultStatus`, `LocalSecretVaultContents`, `LocalSecretVaultError`, `secretVaultExists`, `getSecretVaultStatus`, `createSecretVault`, `verifySecretVaultPassword`, `unlockSecretVault`, `writeSecretVaultSecrets`, `applySecretVaultToProcessEnv`, `stripManagedSecretsFromDotenvFile`.
**New modules under `lib/local-secret-vault/`:** `crypto.ts` (CURRENT_KDF_PARAMS + KDF derive + AEAD encrypt/decrypt primitives — single-source) · `status.ts` (LocalSecretVaultStatus/Contents/Options types, secretVaultExists, getSecretVaultStatus, LocalSecretVaultError) · `lifecycle.ts` (createSecretVault, verifySecretVaultPassword, unlockSecretVault, writeSecretVaultSecrets) · `env.ts` (applySecretVaultToProcessEnv, stripManagedSecretsFromDotenvFile). Façade re-exports all 13.
**CRITICAL:** crypto/KDF moved VERBATIM (same params, same cipher, same salt/iv handling); NEVER log secret/key/password material; no new external dep (@vex-lib/rolldown — keep existing import style).
**Importers (untouched, 13):** polymarket creds, keystore, restore/env-sanitize, compact-jobs/executor, vex-app secrets/onboarding/wallet-export/polymarket-setup. **Guard:** `src/__tests__/config/local-secret-vault.test.ts` (+ vex-app secrets/session, wallet-export tests).

---

### A-026 — `vex-app/src/main/docker/probe.ts` (342 LOC)
**Façade exports (exact, 14):** `parseDockerVersion`, `parseComposeVersion`, `COMPOSE_VERSION_FLOOR`, `ParsedSemver`, `parseSemver`, `semverGte`, `ModelStatusKind`, `parseModelStatus`, `parseDaemonRunning`, `isPortFree`, `isModelRunnerEndpointReachable`, `getAvailableDiskGB`, `DockerProbeOpts`, `probeDocker`.
**New modules under `main/docker/probe/`:** `parsers.ts` (parseDockerVersion, parseComposeVersion, parseModelStatus, parseDaemonRunning, ModelStatusKind) · `version.ts` (COMPOSE_VERSION_FLOOR, ParsedSemver, parseSemver, semverGte) · `ports.ts` (isPortFree, isModelRunnerEndpointReachable) · `disk.ts` (getAvailableDiskGB) · `daemon.ts` (probeDocker, DockerProbeOpts orchestration). Façade re-exports all 14.
**CRITICAL:** `compose/preflight.ts` re-exports `isPortFree` (and lifecycle.ts uses probe primitives) — keep the façade so they resolve; COMPOSE_VERSION_FLOOR value unchanged.
**Importers (untouched):** `compose/preflight.ts`, `compose/lifecycle.ts`, `ipc/docker.ts`. **Guard:** `ipc/__tests__/docker-compose-up.test.ts`.

---

### A-027 — `vex-app/src/main/ipc/wallet-export.ts` (335 LOC) — private-key export (security-critical)
**Façade exports (exact):** `registerWalletExportHandler` + whatever is in the `export { ... }` block at line ~332 (likely test-only internals — preserve EXACTLY).
**New modules under `main/ipc/wallet-export/`:** `errors.ts` (error mapping) · `paths.ts` (path handling + realpath containment) · `handler.ts` (the export handler registration). Keep `registerWalletExportHandler` + the test-export block on the façade.
**CRITICAL:** the private-key export path stays main-only; realpath/path containment preserved; never log key material. First READ the line ~332 `export {}` block and preserve every symbol it exposes (the surface test must pin them).
**Importer (untouched):** `ipc/register-all.ts`. **Guard:** `ipc/__tests__/wallet-export.test.ts`.

---

## Verification protocol (owned by main Claude)
1. root `tsc --noEmit` (A-018, A-025). 2. `vex-app lint` (A-025 @vex-lib + A-026 + A-027 + boundary). 3. single-process vitest both projects over guards + 4 surface tests. 4. git scope: 4 façades + 4 new subdirs + 4 surface tests; zero importers. 5. Codex final-review → per-item commit → FF push.

## Open questions for Codex (plan-review gate)
1. A-018: is the approval-enqueue transaction + BatchOutcome (engine_stop/compact_committed/approval_required) cleanly separable into outcome/execute/approval-stop/results WITHOUT reordering side effects or breaking the tx coupling? Any shared per-call state?
2. A-025: any shared private crypto helper (KDF derive, cipher, salt/iv) across create/verify/unlock/write to single-source in crypto.ts? Confirm no path logs secrets and the split keeps zero plaintext leakage. Is `LocalSecretVaultError` referenced widely enough to need its own module vs status.ts?
3. A-026: which exact probe primitives does `compose/preflight.ts` re-export / `lifecycle.ts` consume (must keep resolving via façade)? Any async/teardown concern splitting ports/disk/daemon?
4. A-027: what's in the `export { ... }` block at line ~332 (test exports?) — list them so the façade + surface test preserve them. Confirm realpath containment + main-only authority stay intact.
5. Anything to serialize, or an additional guard to pin.
