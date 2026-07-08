/**
 * Ambient updater auto-check (M13 follow-up): check for a new version on app
 * start + window focus, throttled. This NEVER downloads — auto-download stays
 * off (`autoDownload=false`); it only surfaces availability so the banner can
 * appear. Allowed by skill vex-user-triggered-updates: "checkForUpdates() may
 * run on app start/focus, but must not download."
 *
 * Guards (Codex review):
 *  - feed gate: skip entirely unless a feed is resolvable (packaged app, or dev
 *    with VEX_UPDATER_DEV_FEED=1) — no error spam in plain dev;
 *  - safe-state guard: only check from idle/current/error/available — never
 *    clobber an in-progress or blocked state (checking/downloading/
 *    downloaded/installing/blockedByOperation). `available` is included
 *    (correctness fix) so a NEWER release can still surface even while the
 *    current one sits snoozed in the renderer's per-version "Later" state —
 *    the renderer's snooze compares against `latestVersion`, so a fresh
 *    `available` for a different version un-snoozes itself automatically.
 *    `configureUpdater.ts`'s `checking-for-update` handler avoids the
 *    resulting flicker by not clobbering a visible `available` toast with
 *    the transient (non-rendering) `checking` state during a silent check;
 *  - focus debounce: short in-memory window so focus bursts don't hammer prefs;
 *  - success throttle: persisted `lastCheckedAt`, ≤ once per SUCCESS_THROTTLE;
 *  - failure backoff: in-memory, so a bad feed doesn't retry on every focus.
 */

import { app } from "electron";
import { log } from "../logger/index.js";
import { preferencesStore } from "../preferences/store.js";
import { getCurrentStatus } from "./statusCache.js";
import { silentCheck } from "./updateActions.js";

const FOCUS_DEBOUNCE_MS = 60 * 1000;
const SUCCESS_THROTTLE_MS = 6 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 20 * 60 * 1000;
const STARTUP_DELAY_MS = 3 * 1000;

let lastAttemptAt = 0;
let lastFailureAt = 0;

function feedConfigured(): boolean {
  return app.isPackaged || process.env.VEX_UPDATER_DEV_FEED === "1";
}

/**
 * Only run an ambient check from a state where re-checking is safe: the
 * quiet states (idle/current/error) AND `available` (see the module
 * docstring for why `available` is included). Never run from an in-progress
 * or already-blocked state (checking/downloading/downloaded/installing/
 * blockedByOperation) — an ambient re-check must not clobber those.
 */
function canRunAmbientCheck(): boolean {
  const kind = getCurrentStatus().kind;
  return (
    kind === "idle" ||
    kind === "current" ||
    kind === "error" ||
    kind === "available"
  );
}

export async function maybeAutoCheck(
  reason: "startup" | "focus",
): Promise<void> {
  if (!feedConfigured()) return;

  const now = Date.now();
  if (now - lastAttemptAt < FOCUS_DEBOUNCE_MS) return;
  lastAttemptAt = now;

  if (!canRunAmbientCheck()) return;
  if (now - lastFailureAt < FAILURE_BACKOFF_MS) return;

  try {
    const prefs = await preferencesStore.load();
    const raw = prefs.updater.lastCheckedAt;
    const last = raw ? Date.parse(raw) : 0;
    if (Number.isFinite(last) && last > 0 && now - last < SUCCESS_THROTTLE_MS) {
      return;
    }
  } catch (cause) {
    log.warn("[updates] auto-check throttle read failed", cause);
    return;
  }

  log.info(`[updates] ambient auto-check (${reason})`);
  const ok = await silentCheck();
  if (!ok) lastFailureAt = Date.now();
}

/**
 * Wire the start + focus ambient checks. Returns a teardown that removes the
 * focus listener and cancels the pending startup check.
 */
export function installUpdaterAutoCheck(): () => void {
  const onFocus = (): void => {
    void maybeAutoCheck("focus");
  };
  app.on("browser-window-focus", onFocus);

  // Deferred so the first check never competes with window paint. `unref` so
  // the timer can't keep the process alive on a fast quit.
  const startupTimer = setTimeout(() => {
    void maybeAutoCheck("startup");
  }, STARTUP_DELAY_MS);
  if (typeof startupTimer.unref === "function") startupTimer.unref();

  return () => {
    app.removeListener("browser-window-focus", onFocus);
    clearTimeout(startupTimer);
  };
}

/** Test-only: reset the in-memory throttles. */
export function __resetAutoCheckForTests(): void {
  lastAttemptAt = 0;
  lastFailureAt = 0;
}
