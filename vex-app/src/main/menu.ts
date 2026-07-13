/**
 * Application menu install policy.
 *
 * Vex is a runtime-style desktop app — the default File/Edit/View/Window
 * menu is visual noise. We strip it differently per platform:
 *
 *   - Windows/Linux: `Menu.setApplicationMenu(null)` — fully removes the
 *     window's menu bar. `autoHideMenuBar` + `setMenuBarVisibility(false)`
 *     would leave Alt as a re-show fallback, which we do not want.
 *
 *   - macOS: a minimal `appMenu + editMenu (+ viewMenu in dev)` template.
 *     macOS *requires* a system menu bar at the top of the screen, and
 *     setting it to null breaks clipboard accelerators in text inputs.
 *
 * Must be called inside `app.whenReady()` before any BrowserWindow opens.
 */

import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { buildMacMenuTemplate } from "./menu-template.js";
import { setKeepAwakeManual, getKeepAwakeState } from "./agent/keep-awake-worker.js";

/**
 * The one operator control we surface in the menu: a "Stay awake" checkbox.
 * A mission run keeps the Mac awake on its own; this lets the operator also
 * hold it awake WITHOUT a mission (e.g. overnight, waiting on the next feed).
 * Electron persists the checkbox's checked state across clicks, so no rebuild.
 */
const stayAwakeMenu: MenuItemConstructorOptions = {
  label: "Power",
  submenu: [
    {
      label: "Keep this Mac awake",
      type: "checkbox",
      checked: getKeepAwakeState().manual,
      click: (item) => {
        setKeepAwakeManual(item.checked);
      },
    },
  ],
};

export function installMinimalMenu(): void {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;
  if (isMac) {
    const template = buildMacMenuTemplate({ isMac, isDev });
    if (template === null) return;
    Menu.setApplicationMenu(Menu.buildFromTemplate([...template, stayAwakeMenu]));
    return;
  }
  Menu.setApplicationMenu(null);
}
