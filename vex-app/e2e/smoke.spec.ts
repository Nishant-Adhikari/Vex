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
 *   5. The splash dismisses and the SystemCheck view mounts within
 *      the expect timeout (proves the Zustand uiStore + the splash
 *      effect run in the renderer).
 *
 * What we INTENTIONALLY do NOT assert:
 *   - Anything past SystemCheck. Docker bootstrap, compose up,
 *     migrations, wizard, unlock — all of those require either a
 *     real Docker daemon or a bypass hook that doesn't exist yet
 *     (Codex S2 turn 2). A real E2E for those screens is a separate
 *     decision, tracked under #13 follow-ups + task #9.
 */

import { test, expect } from "./fixtures/electron-app.js";

test("boots to SystemCheck with the bridged window.vex surface", async ({
  vexApp,
}) => {
  const { firstWindow } = vexApp;

  // Wait for the renderer to finish loading before probing globals.
  // Electron's first window event fires before the preload script
  // has finished bridging contextBridge values; `waitForLoadState`
  // gives us a stable point to query.
  await firstWindow.waitForLoadState("domcontentloaded");

  // 1. contextBridge surface is bound.
  const bridgeShape = await firstWindow.evaluate(() => ({
    vexType: typeof (window as unknown as { vex?: unknown }).vex,
    healthType: typeof (
      window as unknown as { vex?: { system?: { health?: unknown } } }
    ).vex?.system?.health,
  }));
  expect(bridgeShape.vexType).toBe("object");
  expect(bridgeShape.healthType).toBe("function");

  // 2. The splash effect advances the uiStore to systemCheck.
  // `data-vex-screen` is set on every top-level screen container and
  // is stable across refactors (Codex S2 turn 2 selector strategy).
  await expect(
    firstWindow.locator('[data-vex-screen="systemCheck"]')
  ).toBeVisible();
});
