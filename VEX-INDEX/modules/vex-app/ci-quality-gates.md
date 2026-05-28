---
id: module.vex-app.ci-quality-gates
kind: module
paths:
  - ".github/workflows/**"
  - "package.json"
  - "pnpm-lock.yaml"
  - "vex-app/package.json"
  - "vex-app/pnpm-lock.yaml"
  - "vex-app/vitest.config.ts"
  - "vex-app/playwright.config.ts"
  - "vex-app/e2e/**"
  - "vex-app/scripts/**"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - ".github/workflows/**"
  - "package.json"
  - "pnpm-lock.yaml"
  - "vex-app/package.json"
  - "vex-app/pnpm-lock.yaml"
  - "vex-app/vitest.config.ts"
  - "vex-app/playwright.config.ts"
  - "vex-app/e2e/**"
  - "vex-app/scripts/**"
related:
  - module.vex-app.packaging-build-release-updater
  - module.vex-app.local-services-docker
---

# CI / Quality Gates

## Purpose

Indexes current automated verification, what it protects, and what it intentionally does not cover.

## Current gates

- Root package has build/test/integration/eval scripts.
- App package has `lint`, `test`, `test:e2e`, `build`, `postbuild`, `check:build`, `check:boundaries`.
- CI installs both package roots and runs root/app checks.
- App E2E smoke is shallow by design; it excludes Docker bootstrap, compose up, migrations, wizard, and unlock.

## Missing or weak gates

- No full Docker/local-services onboarding E2E.
- No production packaging/signing/notarization/updater metadata CI gate.
- No dependency audit/release security gate in current CI workflow.
- Existing docs outside VEX-INDEX still have drift candidates, e.g. old migration counts in QA docs.

## Refresh triggers

Any workflow, package script, lockfile, test config, E2E smoke, artifact check or process-boundary script change.
