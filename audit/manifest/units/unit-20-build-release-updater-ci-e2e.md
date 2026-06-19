### 2.20 Work Unit 20 — Build, release, updater, CI, e2e

#### Files & LOC

- `vex-app/electron-builder.yml` 69 LOC
- `vex-app/build/afterPack.mjs` 44 LOC
- `vex-app/scripts/check-build-artifacts.mjs` 499 LOC — **god-file/refactor candidate**
- `vex-app/scripts/check-process-boundaries.mjs` 164 LOC
- `.github/workflows/ci.yml` 120 LOC
- `vex-app/package.json` 95 LOC
- `package.json` 72 LOC
- `vex-app/pnpm-lock.yaml` 5,912 LOC — lockfile, not code refactor target
- `pnpm-lock.yaml` 4,218 LOC — lockfile, not code refactor target
- `vex-app/e2e/smoke.spec.ts`

#### Responsibility

- Package Electron app.
- Apply Electron fuses.
- Check packaged build artifacts for security/resource invariants.
- Enforce renderer/shared process-boundary imports.
- Run CI gates.
- Hold dependency and script definitions.
- Provide e2e smoke coverage.

#### Mechanisms/patterns

- `afterPack.mjs` flips Electron fuses:
  - RunAsNode disabled.
  - Node options env disabled.
  - Node CLI inspect disabled.
  - ASAR integrity enabled.
  - only load app from ASAR.
  - cookie encryption enabled.
  - file protocol extra privileges disabled.
- `check-build-artifacts.mjs` checks:
  - CSP.
  - main bundle contains protocol/permission safety indicators.
  - Compose images are digest pinned.
  - Compose ports are loopback-only long syntax.
  - packaged migrations match canonical migrations.
- `check-process-boundaries.mjs` forbids renderer/shared imports of privileged modules.
- CI runs package/test/lint gates.

#### Dependencies & data-flow

Entry points:

- `pnpm --dir vex-app build`
- `pnpm --dir vex-app check:build`
- `pnpm --dir vex-app lint`
- `pnpm --dir vex-app test`
- root `pnpm test`, `pnpm build`

Imports/dependencies:

- Electron 42.
- Vite 8.
- React 19.2.
- TypeScript 6.
- electron-builder/electron-updater.
- Shared root runtime dependencies.

Side effects:

- Build output generation.
- Migration copy into app resources.
- Package artifact creation.
- Fuse mutation of packaged app.
- CI checks.

#### Security surface

- Production signing/notarization/update metadata.
- ASAR/fuse hardening.
- Dependency review.
- Release artifact integrity.
- User-triggered update policy.
- Process-boundary enforcement.

#### Hotspots

- `electron-builder.yml` explicitly dev/test unsigned:
  - `forceCodeSigning:false`
  - `mac.notarize:false`
  - `win.verifyUpdateCodeSignature:false`
  - no publish provider.
- `electron-updater` dependency/config scaffolding exists, but no full updater implementation found:
  - no `autoUpdater`
  - no `checkForUpdates`
  - no `downloadUpdate`
  - no `quitAndInstall`
  - no renderer update card
  - no updater status schema flow.
- No production release job in `.github/workflows/ci.yml`.
- E2E smoke does not assert Docker bootstrap, Compose up, migrations, wizard, or unlock because Docker would be required.
- Current migration mirror drift should fail build artifact check.

`console.*` density:

- Scripts likely use console output. Runtime console posture is separate; process-boundary/build scripts are allowed to print.

#### Tests

Covered:

- CI workflow.
- Process-boundary script.
- Build artifact script.
- E2E smoke.
- Unit tests across app/runtime.

Not covered / unclear:

- Signed/notarized production release.
- Update metadata publishing/order/checksum/signature.
- User-triggered update UX.
- Production update install smoke.
- Dependency review/release rollback.

#### Open risks/smells

- Add production release profile and CI/release workflow.
- Implement user-triggered updater or remove reserved channels until implemented.
- Add update smoke tests.
- Fix migration drift before packaging.
- Verify current electron-builder/electron-updater docs before release implementation.

