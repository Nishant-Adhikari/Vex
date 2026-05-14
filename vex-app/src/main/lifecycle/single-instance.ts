/**
 * Single instance lock: a second app instance is rejected and the existing
 * window is focused.
 *
 * Critical for the shared vault, keystore, and DB: two processes writing
 * concurrently to secrets.vault.json, .env, keystore.json, or preferences.json
 * would risk races, corrupted state, and double unlock.
 *
 * Skill §10 implicit: "user app instance owns local infra contract".
 */

import { app, BrowserWindow } from "electron";

/**
 * @returns true if this is the primary instance and execution should continue.
 * @returns false if a primary instance is already running — caller MUST app.quit() immediately.
 */
export function acquireSingleInstanceLock(): boolean {
  const acquired = app.requestSingleInstanceLock();

  if (!acquired) {
    return false;
  }

  app.on("second-instance", () => {
    const windows = BrowserWindow.getAllWindows();
    const primary = windows.find((w) => !w.isDestroyed());
    if (primary) {
      if (primary.isMinimized()) primary.restore();
      primary.focus();
    }
  });

  return true;
}
