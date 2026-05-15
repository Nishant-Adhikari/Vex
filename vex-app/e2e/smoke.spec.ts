/**
 * PR4 boot smoke — single spec that proves the whole
 * main↔preload↔renderer triangle works against the *built* Electron
 * bundle.
 *
 * What we assert (and why this is enough for a smoke):
 *   1. Electron launches without crashing.
 *   2. The first window opens within the fixture's launch timeout.
 *   3. `window.vex` is bridged through preload (proves the
 *      contextBridge boundary is intact).
 *   4. `window.vex.system.health` is a callable function (proves the
 *      bridged surface matches the `VexBridge` contract — if the
 *      preload `satisfies VexBridge` check ever drifts, this catches
 *      it).
 *   5. The intro screen renders, the user clicks Begin (no auto-
 *      dismiss — that is the documented UX contract in IntroScreen.tsx),
 *      and the SystemCheck view mounts within the expect timeout
 *      (proves the Zustand uiStore + the intro click handler run in
 *      the renderer).
 *
 * What we INTENTIONALLY do NOT assert:
 *   - Anything past SystemCheck. Docker bootstrap, compose up,
 *     migrations, wizard, unlock — all of those require either a
 *     real Docker daemon or a bypass hook that doesn't exist yet
 *     (Codex S2 turn 2). A real E2E for those screens is a separate
 *     decision, tracked under #13 follow-ups + task #9.
 */

import path from "node:path";
import { test, expect } from "./fixtures/electron-app.js";

test("boots through intro to SystemCheck with the bridged window.vex surface", async ({
  vexApp,
}) => {
  const { app, firstWindow, configDir } = vexApp;

  // 1. Per-spec config isolation actually took effect.
  // Verified via Electron's own `app.getPath("userData")`, which the
  // main process remaps to `CONFIG_DIR/.electron-state` after the
  // VEX_CONFIG_DIR override resolves CONFIG_DIR to our tmpdir.
  const userDataDir = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath("userData"),
  );
  expect(userDataDir).toBe(path.join(configDir, ".electron-state"));

  // Wait for the renderer to finish loading before probing globals.
  // Electron's first window event fires before the preload script
  // has finished bridging contextBridge values; `waitForLoadState`
  // gives us a stable point to query.
  await firstWindow.waitForLoadState("domcontentloaded");

  // 2. contextBridge surface is bound.
  const bridgeShape = await firstWindow.evaluate(() => ({
    vexType: typeof (window as unknown as { vex?: unknown }).vex,
    healthType: typeof (
      window as unknown as { vex?: { system?: { health?: unknown } } }
    ).vex?.system?.health,
  }));
  expect(bridgeShape.vexType).toBe("object");
  expect(bridgeShape.healthType).toBe("function");

  // 3. The intro screen renders first.
  // `data-vex-screen` is set on every top-level screen container and
  // is stable across refactors (Codex S2 turn 2 selector strategy).
  await expect(
    firstWindow.locator('[data-vex-screen="intro"]')
  ).toBeVisible();

  // 4. The loader animates 0→100% (~3.5s real time) and Begin appears.
  // Use an explicit `toBeVisible()` assertion before clicking so the
  // wait is bounded by `expect.timeout: 15_000` (playwright.config.ts)
  // and failures are reported as "Begin button did not become visible"
  // rather than a generic click timeout. No auto-dismiss: clicking
  // Begin is the only exit (documented UX contract in IntroScreen.tsx).
  const beginButton = firstWindow.getByRole("button", { name: /begin/i });
  await expect(beginButton).toBeVisible();
  await beginButton.click();

  // 5. Click advances uiStore.currentView to systemCheck.
  await expect(
    firstWindow.locator('[data-vex-screen="systemCheck"]')
  ).toBeVisible();
});
