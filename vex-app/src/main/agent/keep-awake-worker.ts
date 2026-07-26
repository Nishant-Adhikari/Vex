/**
 * Keep-awake worker — hold the machine awake so long-running / overnight
 * missions don't get suspended when the Mac would otherwise sleep.
 *
 * Two inputs decide the desired state, OR-combined:
 *   - `manual`  — an explicit user toggle ("Stay awake"), persisted to
 *                 userData/keep-awake-state.json and restored on startup so a
 *                 crash/restart does not silently drop it.
 *   - `mission` — whether any mission run is actively executing a turn loop
 *                 (`activeMissionRunCount()`), polled so a mission that starts
 *                 keeps the machine up on its own. This leg is itself GATED by
 *                 the persisted `ui.keepAwakeDuringMission` preference (default
 *                 true): when the user turns it off, an active mission no longer
 *                 holds the Mac awake; the manual toggle is unaffected.
 *
 * TWO STACKED LAYERS, reconciled together:
 *   1. IDLE — Electron's `powerSaveBlocker("prevent-app-suspension")`. Stops idle
 *      sleep (the DISPLAY may still sleep, which is what you want overnight).
 *      Driven by `manual || (missionGate && missionRunning)`.
 *   2. CLAMSHELL (macOS lid-close) — `pmset disablesleep 1` via an admin prompt,
 *      the ONLY lever that survives a closed lid, which `powerSaveBlocker` does
 *      NOT. Driven by the MISSION leg ONLY (`missionGate && missionRunning`) —
 *      never the manual/idle leg — so we only ever touch the system power setting
 *      when a real mission is running with the toggle on. See
 *      `keep-awake-clamshell.ts` for the guaranteed-restore + boot-reset safety.
 *
 * Both layers are reconciled from the same `reconcile()` so idle + clamshell flip
 * together and consistently.
 */

import { app, powerSaveBlocker } from "electron";
import fs from "node:fs";
import path from "node:path";
import { activeMissionRunCount } from "@vex-agent/engine/core/runner/abort.js";
import { preferencesStore } from "../preferences/store.js";
import { log } from "../logger/index.js";
import {
  bootSafetyResetClamshell,
  getClamshellStatus,
  reconcileClamshell,
  restoreClamshellOnQuit,
  type ClamshellStatus,
} from "./keep-awake-clamshell.js";

/** How often to re-check mission activity + reconcile the blocker. */
const POLL_MS = 10_000;

let blockerId: number | null = null;
let manualOn = false;
/**
 * Whether the mission leg is allowed to hold the machine awake. Mirrors the
 * persisted `ui.keepAwakeDuringMission` preference; default true preserves the
 * prior always-on-during-a-mission behavior until prefs are hydrated / changed.
 */
let missionGateEnabled = true;

// ---------------------------------------------------------------------------
// Persistence helpers — survive crashes / restarts (KEEPAWAKE-001)
// ---------------------------------------------------------------------------

/** Resolved lazily; null when userData path is unavailable (e.g. in tests). */
let _stateFilePath: string | null | undefined;

function stateFilePath(): string | null {
  if (_stateFilePath === undefined) {
    try {
      _stateFilePath = path.join(
        app.getPath("userData"),
        "keep-awake-state.json",
      );
    } catch {
      _stateFilePath = null;
    }
  }
  return _stateFilePath;
}

function readPersistedManualOn(): boolean {
  const filePath = stateFilePath();
  if (!filePath) return false;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "manualOn" in parsed
    ) {
      return Boolean((parsed as { manualOn: unknown }).manualOn);
    }
  } catch {
    log.warn("[keep-awake] could not read persisted state, defaulting manualOn=false");
  }
  return false;
}

function writePersistedManualOn(on: boolean): void {
  const filePath = stateFilePath();
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify({ manualOn: on }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    log.warn("[keep-awake] could not persist manualOn state", error);
  }
}

function isActive(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId);
}

function missionRunning(): boolean {
  try {
    return activeMissionRunCount() > 0;
  } catch {
    return false;
  }
}

/**
 * The clamshell (lid-close) leg is MISSION-scoped only: the persisted toggle is
 * on AND a mission run is active. The manual/idle leg deliberately does NOT reach
 * `pmset` — we only touch the system power setting for a real running mission.
 */
function clamshellDesired(): boolean {
  return missionGateEnabled && missionRunning();
}

// Serialize the async clamshell reconcile so overlapping polls / toggles can't
// fire two admin prompts or two `pmset` calls at once. A request that arrives
// mid-flight is coalesced into one trailing re-run.
let clamshellInFlight = false;
let clamshellRerunQueued = false;

function reconcileClamshellLeg(): void {
  if (clamshellInFlight) {
    clamshellRerunQueued = true;
    return;
  }
  clamshellInFlight = true;
  void reconcileClamshell(clamshellDesired())
    .catch((error) => log.error("[keep-awake] clamshell reconcile threw", error))
    .finally(() => {
      clamshellInFlight = false;
      if (clamshellRerunQueued) {
        clamshellRerunQueued = false;
        reconcileClamshellLeg();
      }
    });
}

/**
 * Reconcile BOTH layers. The idle `powerSaveBlocker` matches
 * `manual || (missionGate && missionRunning)`; the clamshell layer matches
 * `missionGate && missionRunning` (see `clamshellDesired`). Idempotent.
 */
function reconcile(): void {
  const desired = manualOn || (missionGateEnabled && missionRunning());
  if (desired && !isActive()) {
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
    log.info(
      `[keep-awake] engaged (manual=${manualOn} missionGate=${missionGateEnabled} mission=${missionRunning()})`,
    );
  } else if (!desired && isActive()) {
    powerSaveBlocker.stop(blockerId as number);
    blockerId = null;
    log.info("[keep-awake] released");
  }
  // Clamshell (macOS lid-close) layer — mission-scoped, async, fire-and-forget.
  reconcileClamshellLeg();
}

/** User toggle. Persisted to disk so the value survives app restarts/crashes. */
export function setKeepAwakeManual(on: boolean): void {
  writePersistedManualOn(on);
  manualOn = on;
  reconcile();
}

/**
 * Gate the mission leg (persisted `ui.keepAwakeDuringMission`). Turning it off
 * during an active run releases the blocker on the next reconcile; turning it
 * on while a run is active engages it. Idempotent.
 */
export function setKeepAwakeMissionGate(on: boolean): void {
  missionGateEnabled = on;
  reconcile();
}

/** Current state for the renderer toggle + clamshell indicator. */
export function getKeepAwakeState(): {
  manual: boolean;
  missionGate: boolean;
  active: boolean;
  missionRunning: boolean;
  clamshell: ClamshellStatus;
} {
  return {
    manual: manualOn,
    missionGate: missionGateEnabled,
    active: isActive(),
    missionRunning: missionRunning(),
    clamshell: getClamshellStatus(),
  };
}

/**
 * Start the reconcile loop. Returns an async teardown that releases BOTH layers
 * (idle blocker + clamshell `pmset disablesleep 0`). Safe to call once from
 * `initializeMainRuntime`.
 *
 * A boot-time safety reset runs first: no mission is active at app start, so if a
 * prior crash left `pmset disablesleep 1` behind, clear it (guarded so a healthy
 * launch never prompts — see `bootSafetyResetClamshell`).
 */
export function setupKeepAwakeWorker(): () => Promise<void> {
  // Restore manual toggle from disk — survives crashes and restarts.
  manualOn = readPersistedManualOn();

  // Boot-time safety reset — before the loop, while no mission can be active.
  void bootSafetyResetClamshell().catch((error) =>
    log.error("[keep-awake] boot safety reset threw", error),
  );

  const timer = setInterval(reconcile, POLL_MS);
  reconcile();
  // Hydrate the mission gate from persisted prefs and track live changes so the
  // main-process keep-awake always reflects the current toggle without a poll.
  // The renderer never writes this flag directly — it flows preferences → main.
  const unsubscribe = preferencesStore.subscribe((prefs) => {
    setKeepAwakeMissionGate(prefs.ui.keepAwakeDuringMission);
  });
  void preferencesStore
    .load()
    .then((prefs) => setKeepAwakeMissionGate(prefs.ui.keepAwakeDuringMission))
    .catch(() => undefined);
  return async () => {
    clearInterval(timer);
    unsubscribe();
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
    // Restore the system power setting on quit — only if WE set it. Awaited so
    // the ordered-quit drain doesn't race process exit.
    await restoreClamshellOnQuit();
  };
}
