/**
 * BrowserWindow factory z full security lockdown per skill §7.
 *
 * webPreferences locked: contextIsolation, sandbox, no nodeIntegration,
 * webSecurity, no insecure content, devTools only in dev builds, CJS preload.
 * Window state persisted via preferencesStore.
 */

import { BrowserWindow, app, screen, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../logger/index.js";
import { preferencesStore } from "../preferences/store.js";
import { APP_ORIGIN } from "../protocol/app-protocol.js";
import {
  isAllowedExternalUrl,
  type ExternalAllowEntry,
} from "../security/url.js";
import {
  clampToVisibleArea,
  type DisplayInfo,
} from "./visibility.js";

/**
 * Safety timeout (ms) before forcing `win.show()` if `ready-to-show`
 * never fires. WSLg + Electron in copy-mode presentation can stall on
 * the ready signal — without this the window stays `show: false`
 * forever and the user only sees a taskbar entry (codex turn 3).
 */
const READY_TO_SHOW_SAFETY_MS = 5_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * External-link allowlist for shell.openExternal.
 * Each entry is a host (exact match) or {host, pathPrefix} (path-boundary match).
 * Default scheme: `https:` — http: never allowed externally.
 *
 * Path prefixes are matched with boundary respect: `/electron/electron/releases`
 * matches `/electron/electron/releases` and `/electron/electron/releases/...`,
 * NOT `/electron/electron/releases-malicious`. See `pathStartsWithBoundary`.
 */
const ALLOWED_EXTERNAL: ReadonlyArray<ExternalAllowEntry> = [
  "vex.ai",
  "docs.vex.ai",
  "portal.jup.ag",
  "openrouter.ai",
  "releases.electronjs.org",
  "desktop.docker.com",
  "docs.docker.com",
  // GitHub: restrict to Vex Foundation org + Electron releases (specific repos only)
  { host: "github.com", pathPrefix: "/Vex-Foundation/" },
  { host: "github.com", pathPrefix: "/electron/electron/releases" },
];

function checkExternalUrl(raw: string): boolean {
  return isAllowedExternalUrl(raw, ALLOWED_EXTERNAL);
}

function isAllowedAppUrl(raw: string): boolean {
  if (raw.startsWith(`${APP_ORIGIN}/`) || raw === APP_ORIGIN) return true;
  if (!app.isPackaged && raw.startsWith("http://127.0.0.1:5173/")) return true;
  return false;
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const prefs = await preferencesStore.load();

  // Normalize saved bounds against the *current* display config. A
  // previously-docked secondary monitor may be gone, DPI may have
  // changed, etc. — restoring stale x/y verbatim opens the window
  // off-screen (codex turn 3).
  const allDisplays: ReadonlyArray<DisplayInfo> = screen.getAllDisplays();
  const primary: DisplayInfo | null = (() => {
    try {
      return screen.getPrimaryDisplay();
    } catch {
      return null;
    }
  })();
  const normalized = clampToVisibleArea(prefs.window, allDisplays, primary);
  log.info(
    `[window] saved=${JSON.stringify(prefs.window)} normalized=${JSON.stringify(
      normalized
    )} displays=${JSON.stringify(allDisplays.map((d) => d.workArea))}`
  );

  const win = new BrowserWindow({
    width: normalized.width,
    height: normalized.height,
    x: normalized.x ?? undefined,
    y: normalized.y ?? undefined,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#0A0E27",
    title: "Vex",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: !app.isPackaged,
    },
  });

  if (prefs.window.maximized) win.maximize();

  // Window state persistence on close.
  const persistState = (): void => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    void preferencesStore.update({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized(),
      },
    });
  };
  win.on("close", persistState);

  // Block window.open + redirect to allowlisted external opener.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (checkExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block in-window navigation to anything outside app://vex/ + dev server.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppUrl(url)) {
      event.preventDefault();
      if (checkExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  // Diagnostic: catch renderer load failures (CSP block, ENOTCONN to
  // dev server, asar protocol bug, etc.) so the smoke test surfaces
  // them immediately instead of showing a silent blank window.
  win.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedURL) => {
      log.error(
        `[window] did-fail-load code=${code} url=${validatedURL} desc=${description}`
      );
    }
  );

  // Show on first paint — but with a hard safety timeout so a stalled
  // `ready-to-show` (known WSLg/Electron edge case) does not leave the
  // user staring at a taskbar entry forever (codex turn 3).
  let shown = false;
  const showOnce = (reason: string): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    log.info(`[window] showing main window (trigger: ${reason})`);
    win.show();
    win.focus();
  };
  win.once("ready-to-show", () => showOnce("ready-to-show"));
  const safetyTimer = setTimeout(() => {
    if (!shown) {
      log.warn(
        `[window] ready-to-show did not fire within ${READY_TO_SHOW_SAFETY_MS}ms; forcing show`
      );
      showOnce("safety-timeout");
    }
  }, READY_TO_SHOW_SAFETY_MS);
  safetyTimer.unref?.();
  win.on("closed", () => {
    clearTimeout(safetyTimer);
  });

  // Load renderer.
  //
  // `app.isPackaged` is FALSE when Electron is launched directly against
  // `dist/main/index.js` (the path Playwright uses via `_electron.launch`).
  // In that mode there is no Vite dev server to fall back to, so we honour
  // an explicit `VEX_E2E_LOAD_BUILT=1` override that forces the production
  // load path through the `app://vex/` protocol. The renderer bundle must
  // exist on disk (i.e. `pnpm run build` has run); CI orders the e2e job
  // after the build step to enforce that.
  const loadBuiltBundle =
    app.isPackaged || process.env["VEX_E2E_LOAD_BUILT"] === "1";
  if (loadBuiltBundle) {
    await win.loadURL(`${APP_ORIGIN}/index.html`);
  } else {
    await win.loadURL("http://127.0.0.1:5173/");
  }

  return win;
}
