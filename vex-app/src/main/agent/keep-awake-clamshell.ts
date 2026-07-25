/**
 * Clamshell keep-awake — the macOS "lid-closed" layer for long-running / overnight
 * missions, stacked on top of the `powerSaveBlocker` idle layer in
 * `keep-awake-worker.ts`.
 *
 * `powerSaveBlocker("prevent-app-suspension")` stops IDLE sleep but does NOT
 * survive a CLOSED LID on macOS (clamshell mode still sleeps). The only lever
 * that overrides clamshell sleep is `pmset disablesleep 1`, which requires root.
 * We obtain root for that ONE command via a macOS admin-authorization prompt:
 *
 *     osascript -e 'do shell script "/usr/bin/pmset disablesleep 1"
 *                   with administrator privileges'
 *
 * SAFETY IS THE WHOLE GAME HERE — a machine must NEVER be left permanently unable
 * to sleep. Every guard below exists to guarantee restore:
 *
 *   - We only ever run `disablesleep 1` when the caller says "desired" (the
 *     mission keep-awake toggle is ON *and* a mission run is active). The worker
 *     never passes the manual/idle leg here — clamshell is mission-scoped only.
 *   - `disablesleep 0` is run on EVERY release path: desired→false (mission end /
 *     toggle off), app quit, and a boot-time safety reset (see below).
 *   - `weDisabledSleep` tracks that WE set it, so we only restore what we enabled
 *     and never clobber a value the user set by hand.
 *   - The boot-time reset reads the CURRENT setting with a NON-privileged
 *     `pmset -g` and only prompts for admin to clear it when a prior crash
 *     actually left `disablesleep 1` behind — so a healthy launch never prompts.
 *   - If the user cancels the admin prompt we fall back to idle-only
 *     (`powerSaveBlocker` keeps running) and report `adminDeclined` so the UI can
 *     say lid-close won't be prevented. We never hard-fail the mission or toggle.
 *
 * Restore also needs root, so `disablesleep 0` can itself prompt. macOS caches
 * the admin credential for ~5 min after the enable, so an enable→disable inside a
 * session usually restores silently. Worst case (quit hours later, no cached
 * auth, nobody at the keyboard) the setting persists until the next launch, where
 * the boot-time reset clears it with a prompt the present user answers — so the
 * machine is never *permanently* stranded.
 *
 * Every state transition is logged. Non-macOS is a hard no-op.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "../logger/index.js";

const execFileAsync = promisify(execFile);

/**
 * The privileged/OS surface, injected so tests can assert reconcile behavior
 * WITHOUT ever invoking `pmset`/`osascript`. `setDisableSleep` is the privileged
 * write (admin prompt); `isSleepDisabled` is the non-privileged read.
 */
export interface ClamshellPlatform {
  /** Run `pmset disablesleep <1|0>` via a macOS admin-authorization prompt. */
  readonly setDisableSleep: (disable: boolean) => Promise<void>;
  /** Read the current `SleepDisabled` flag (non-privileged `pmset -g`). */
  readonly isSleepDisabled: () => Promise<boolean>;
}

/** Thrown by the default platform when the user cancels the admin prompt. */
export class AdminDeclinedError extends Error {
  constructor() {
    super("Administrator authorization was declined.");
    this.name = "AdminDeclinedError";
  }
}

export interface ClamshellStatus {
  /** We currently hold `disablesleep 1` (lid-close is being prevented). */
  readonly active: boolean;
  /** The user cancelled the admin prompt this cycle → idle-only fallback. */
  readonly adminDeclined: boolean;
  /** false on non-macOS (clamshell override is a no-op). */
  readonly supported: boolean;
}

function isMac(): boolean {
  return process.platform === "darwin";
}

/** osascript's user-cancel signature (`-128` / "User canceled."). */
function isUserCancel(error: unknown): boolean {
  if (error instanceof AdminDeclinedError) return true;
  const parts: string[] = [];
  if (error instanceof Error && typeof error.message === "string") {
    parts.push(error.message);
  }
  const withStreams = error as { stderr?: unknown; stdout?: unknown };
  if (typeof withStreams?.stderr === "string") parts.push(withStreams.stderr);
  if (typeof withStreams?.stdout === "string") parts.push(withStreams.stdout);
  const blob = parts.join(" ");
  return /User canceled|User cancelled|-128\b/.test(blob);
}

const defaultPlatform: ClamshellPlatform = {
  async setDisableSleep(disable: boolean): Promise<void> {
    const value = disable ? 1 : 0;
    // Single privileged command via one admin prompt. Generous timeout so the
    // prompt isn't killed while the user is deciding.
    const script = `do shell script "/usr/bin/pmset disablesleep ${value}" with administrator privileges`;
    try {
      await execFileAsync("/usr/bin/osascript", ["-e", script], {
        timeout: 120_000,
      });
    } catch (error) {
      if (isUserCancel(error)) throw new AdminDeclinedError();
      throw error;
    }
  },
  async isSleepDisabled(): Promise<boolean> {
    // Non-privileged read of active power settings — never prompts.
    const { stdout } = await execFileAsync("/usr/bin/pmset", ["-g"], {
      timeout: 5_000,
    });
    return /SleepDisabled\s+1\b/.test(stdout);
  },
};

let platform: ClamshellPlatform = defaultPlatform;

// --- module state (per-process; the machine's real state is authoritative) ---

/** Whether WE issued `disablesleep 1` (so we only ever restore what we set). */
let weDisabledSleep = false;
/** Sticky-per-attempt: the user cancelled the admin prompt this engage cycle. */
let adminDeclined = false;

/**
 * Drive the clamshell override toward `desired`.
 *
 *   desired && !ours && !declined  → prompt for admin, `pmset disablesleep 1`
 *   !desired && ours               → `pmset disablesleep 0` (restore)
 *
 * Idempotent and fail-soft: a failed enable/restore never throws to the caller;
 * a failed restore keeps `weDisabledSleep` set so the next reconcile / boot
 * reset retries. Returns the resulting status for the UI.
 */
export async function reconcileClamshell(
  desired: boolean,
): Promise<ClamshellStatus> {
  if (!isMac()) {
    return { active: false, adminDeclined: false, supported: false };
  }

  if (desired) {
    if (!weDisabledSleep && !adminDeclined) {
      try {
        await platform.setDisableSleep(true);
        weDisabledSleep = true;
        log.info(
          "[keep-awake] clamshell override engaged — pmset disablesleep 1 (lid-close will NOT sleep)",
        );
      } catch (error) {
        if (isUserCancel(error)) {
          adminDeclined = true;
          log.warn(
            "[keep-awake] clamshell admin authorization declined — falling back to idle-only (powerSaveBlocker); closing the lid will still sleep the Mac",
          );
        } else {
          log.error("[keep-awake] clamshell enable failed", error);
        }
      }
    }
  } else {
    // desired=false clears the decline flag so the NEXT engage (new mission /
    // toggle back on) gets a fresh admin prompt rather than silently staying off.
    adminDeclined = false;
    if (weDisabledSleep) {
      try {
        await platform.setDisableSleep(false);
        weDisabledSleep = false;
        log.info(
          "[keep-awake] clamshell override released — pmset disablesleep 0",
        );
      } catch (error) {
        // Keep weDisabledSleep=true so a later reconcile / boot reset retries.
        log.error(
          "[keep-awake] clamshell restore FAILED — the Mac may not sleep on lid-close until the next app launch (boot reset will clear it)",
          error,
        );
      }
    }
  }

  return {
    active: weDisabledSleep,
    adminDeclined,
    supported: true,
  };
}

/**
 * Restore on app quit — only if WE set it. Awaited by the worker teardown so the
 * ordered-quit drain doesn't race the process exit.
 */
export async function restoreClamshellOnQuit(): Promise<void> {
  if (!isMac() || !weDisabledSleep) return;
  try {
    await platform.setDisableSleep(false);
    weDisabledSleep = false;
    log.info("[keep-awake] clamshell override released on quit — pmset disablesleep 0");
  } catch (error) {
    log.error(
      "[keep-awake] clamshell restore on quit FAILED — the boot-time safety reset will clear it on next launch",
      error,
    );
  }
}

/**
 * Boot-time safety reset: a prior crash could have left `disablesleep 1` with no
 * live mission. Read the CURRENT flag non-privileged first and only prompt for
 * admin to clear it when it is actually stuck on — a healthy launch never
 * prompts. Called at app start with no mission active.
 */
export async function bootSafetyResetClamshell(): Promise<void> {
  if (!isMac()) return;
  let stuckOn = false;
  try {
    stuckOn = await platform.isSleepDisabled();
  } catch (error) {
    // Can't read the state — do NOT blindly run a privileged clear (that would
    // prompt on every launch). Log and move on; a real mission reconcile still
    // manages its own lifecycle.
    log.warn("[keep-awake] boot safety reset — could not read pmset state; skipping", error);
    return;
  }
  if (!stuckOn) {
    log.info("[keep-awake] boot safety reset — sleep already enabled, no-op");
    weDisabledSleep = false;
    return;
  }
  log.warn(
    "[keep-awake] boot safety reset — found stale pmset disablesleep from a prior run; clearing it (pmset disablesleep 0)",
  );
  try {
    await platform.setDisableSleep(false);
    log.info("[keep-awake] boot safety reset — cleared stale clamshell override");
  } catch (error) {
    log.error("[keep-awake] boot safety reset FAILED to clear stale override", error);
  }
  weDisabledSleep = false;
}

/** Current status for the renderer indicator (no side effects). */
export function getClamshellStatus(): ClamshellStatus {
  return {
    active: weDisabledSleep,
    adminDeclined,
    supported: isMac(),
  };
}

// --- test seams ---

/** Inject a fake platform. Pass `null` to restore the real osascript/pmset one. */
export function __setClamshellPlatformForTest(
  next: ClamshellPlatform | null,
): void {
  platform = next ?? defaultPlatform;
}

/** Reset module state between tests. */
export function __resetClamshellStateForTest(): void {
  weDisabledSleep = false;
  adminDeclined = false;
}
