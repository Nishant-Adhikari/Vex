/**
 * Playwright test fixture: launches the *built* Electron app against a
 * fresh per-spec tmpdir, hands the test back the `ElectronApplication`
 * + its first window, then tears everything down on completion.
 *
 * Per-spec isolation strategy:
 *   - mint a tmpdir with `mkdtempSync`
 *   - set `VEX_CONFIG_DIR=<tmpdir>` in the launched env (honoured by
 *     both `vex-app/src/main/paths/config-dir.ts` and the root
 *     `src/config/paths.ts`)
 *   - on teardown, close the Electron app + remove the tmpdir
 *
 * We do NOT set `NODE_ENV=test` — Codex S2 turn 2 review: keep the
 * launch as close to the built-app default as possible; only the
 * `VEX_CONFIG_DIR` override is intentional.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, _electron, type ElectronApplication, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the built main bundle. Tests assume `pnpm run build`
 * has already produced `dist/main/index.js`; CI orders the e2e job
 * after the build job to enforce this.
 */
const MAIN_BUNDLE = path.resolve(__dirname, "../../dist/main/index.js");

export interface VexElectronFixture {
  readonly app: ElectronApplication;
  readonly firstWindow: Page;
  readonly configDir: string;
}

export const test = base.extend<{ vexApp: VexElectronFixture }>({
  vexApp: async ({}, use) => {
    const configDir = mkdtempSync(path.join(tmpdir(), "vex-e2e-"));
    const app = await _electron.launch({
      args: [MAIN_BUNDLE],
      env: {
        ...process.env,
        VEX_CONFIG_DIR: configDir,
      },
    });
    let firstWindow: Page;
    try {
      firstWindow = await app.firstWindow();
    } catch (cause) {
      // If the window never arrives the app is wedged — close + clean
      // before re-throwing so the test failure is the real signal, not
      // a leak.
      try {
        await app.close();
      } catch {
        /* best-effort */
      }
      rmSync(configDir, { recursive: true, force: true });
      throw cause;
    }

    await use({ app, firstWindow, configDir });

    try {
      await app.close();
    } catch {
      /* main may already be torn down on cancel paths */
    }
    rmSync(configDir, { recursive: true, force: true });
  },
});

export const expect = test.expect;
