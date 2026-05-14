/**
 * Playwright config for Vex desktop smoke tests (PR4).
 *
 * Drives the *built* Electron app via `_electron.launch({ args: [<built main>] })`.
 * NOT a browser test — we never use a chromium binary directly; only
 * Playwright's system-library deps are needed in CI (`pnpm exec
 * playwright install-deps chromium`).
 *
 * On Linux CI the runner needs an X server; wrap the run with
 * `xvfb-run -a pnpm run test:e2e`.
 *
 * Workers are pinned to 1 because:
 *   - xvfb + Electron + WSL2 + parallel display servers = flake;
 *   - main-process global state (cancelRegistry, single-instance lock,
 *     etc.) is per-process and would collide across parallel launches.
 */

import { defineConfig } from "@playwright/test";

const isCI = process.env.CI === "true";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "./test-results",
  use: {
    trace: isCI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "electron-smoke",
      testMatch: /.*\.spec\.ts$/,
    },
  ],
});
