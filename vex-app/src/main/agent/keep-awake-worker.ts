/**
 * Keep-awake worker — hold the machine awake so long-running / overnight
 * missions don't get suspended when the Mac would otherwise sleep.
 *
 * Two inputs decide the desired state, OR-combined:
 *   - `manual`  — an explicit user toggle ("Stay awake"), persisted only for the
 *                 process lifetime; the operator flips it before leaving.
 *   - `mission` — whether any mission run is actively executing a turn loop
 *                 (`activeMissionRunCount()`), polled so a mission that starts
 *                 keeps the machine up on its own.
 *
 * Uses Electron's `powerSaveBlocker` with `prevent-app-suspension` — the system
 * stays awake (the DISPLAY may still sleep, which is what you want overnight).
 * Note: `prevent-app-suspension` does NOT override a closed lid on macOS; keep
 * the lid open (or use an external display) for a true all-nighter.
 */

import { powerSaveBlocker } from "electron";
import { activeMissionRunCount } from "@vex-agent/engine/core/runner/abort.js";
import { log } from "../logger/index.js";

/** How often to re-check mission activity + reconcile the blocker. */
const POLL_MS = 10_000;

let blockerId: number | null = null;
let manualOn = false;

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

/** Start/stop the blocker to match `manual || missionRunning`. Idempotent. */
function reconcile(): void {
  const desired = manualOn || missionRunning();
  if (desired && !isActive()) {
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
    log.info(
      `[keep-awake] engaged (manual=${manualOn} mission=${missionRunning()})`,
    );
  } else if (!desired && isActive()) {
    powerSaveBlocker.stop(blockerId as number);
    blockerId = null;
    log.info("[keep-awake] released");
  }
}

/** User toggle. */
export function setKeepAwakeManual(on: boolean): void {
  manualOn = on;
  reconcile();
}

/** Current state for the renderer toggle. */
export function getKeepAwakeState(): {
  manual: boolean;
  active: boolean;
  missionRunning: boolean;
} {
  return { manual: manualOn, active: isActive(), missionRunning: missionRunning() };
}

/**
 * Start the reconcile loop. Returns a teardown that releases the blocker. Safe
 * to call once from `initializeMainRuntime`.
 */
export function setupKeepAwakeWorker(): () => void {
  const timer = setInterval(reconcile, POLL_MS);
  reconcile();
  return () => {
    clearInterval(timer);
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  };
}
