---
id: module.vex-app.packaging-build-release-updater
kind: module
paths:
  - "vex-app/electron-builder.yml"
  - "vex-app/build/**"
  - "vex-app/vite*.config.ts"
  - "vex-app/scripts/check-build-artifacts.mjs"
  - "vex-app/package.json"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "vex-app/electron-builder.yml"
  - "vex-app/build/**"
  - "vex-app/vite*.config.ts"
  - "vex-app/scripts/check-build-artifacts.mjs"
  - "vex-app/package.json"
  - "vex-app/pnpm-lock.yaml"
  - ".github/workflows/**"
related:
  - module.vex-app.ci-quality-gates
  - module.vex-app.local-services-docker
---

# vex-app Packaging / Build / Release / Updater

## Purpose

Indexes app build and packaging configuration, hardening gates, release-profile state, and updater
implementation status.

## Current state

- `vex-app/package.json` builds main, preload and renderer with Vite; `postbuild` runs artifact checks.
- `electron-builder.yml` is explicitly an internal unsigned dev/test profile.
- `afterPack.mjs` applies Electron fuses before packaged artifacts are considered valid.
- `check-build-artifacts.mjs` validates CSP/protocol/preload/renderer/compose/migration safety.
- `electron-updater` is installed and channel constants exist, but no runtime updater implementation/handler is registered.
- No silent update download/install path exists today.
- No production release workflow exists for signing, notarization, updater metadata, checksums, SBOM, or release promotion.

## Invariants

- User-triggered update policy: no silent production auto-download or auto-install.
- Production release cannot reuse the unsigned dev/test profile as-is.
- Fuses, signing, notarization and updater metadata must be aligned in release order.

## Known gaps

- Updater IPC constants are placeholders/reserved.
- macOS notarization and Windows signature verification are disabled in current builder config.
- CI does not package signed artifacts or produce update metadata.

## Refresh triggers

Any builder config, Vite config, app package scripts/deps, artifact checks, build scripts, or CI release workflow changes.
