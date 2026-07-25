/**
 * keep-awake-clamshell tests (fork feature).
 *
 * Pins the macOS clamshell (lid-close) override's SAFETY behavior WITHOUT ever
 * invoking the real `pmset`/`osascript` — the privileged/OS surface is injected
 * via `__setClamshellPlatformForTest`:
 *
 *   - `disablesleep 1` runs ONLY when desired (toggle+mission) and not yet ours;
 *   - `disablesleep 0` restore fires on desired→false, on quit, and on the
 *     boot-time reset (when a stale flag is found);
 *   - we ONLY restore what WE set (never clobber a hand-set value);
 *   - a declined admin prompt → idle-only fallback, no throw, no crash;
 *   - the boot reset reads state non-privileged and no-ops when already enabled;
 *   - every entry point is a hard no-op off macOS.
 *
 * `process.platform` is overridden per-test so the macOS path is exercised on
 * any CI host, and forced to a non-darwin value for the guard test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminDeclinedError,
  bootSafetyResetClamshell,
  getClamshellStatus,
  reconcileClamshell,
  restoreClamshellOnQuit,
  __resetClamshellStateForTest,
  __setClamshellPlatformForTest,
  type ClamshellPlatform,
} from "../keep-awake-clamshell.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const realPlatform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value,
  });
}

/** A fake privileged surface; `setDisableSleep`/`isSleepDisabled` are spies. */
function makePlatform(over: Partial<ClamshellPlatform> = {}): {
  platform: ClamshellPlatform;
  setDisableSleep: ReturnType<typeof vi.fn>;
  isSleepDisabled: ReturnType<typeof vi.fn>;
} {
  // Wrap any override in a spy so the RETURNED reference is the one the platform
  // actually calls (a bare `...over` would leave the returned default spies
  // detached from the platform).
  const setDisableSleep = vi.fn(
    (over.setDisableSleep as ((d: boolean) => Promise<void>) | undefined) ??
      (async (_disable: boolean) => undefined),
  );
  const isSleepDisabled = vi.fn(
    (over.isSleepDisabled as (() => Promise<boolean>) | undefined) ??
      (async () => false),
  );
  const platform: ClamshellPlatform = { setDisableSleep, isSleepDisabled };
  return { platform, setDisableSleep, isSleepDisabled };
}

beforeEach(() => {
  setPlatform("darwin");
  __resetClamshellStateForTest();
});

afterEach(() => {
  setPlatform(realPlatform);
  __setClamshellPlatformForTest(null);
  __resetClamshellStateForTest();
});

describe("clamshell reconcile — enable gating", () => {
  it("runs pmset disablesleep 1 exactly once when desired and not yet ours", async () => {
    const { platform, setDisableSleep } = makePlatform();
    __setClamshellPlatformForTest(platform);

    const first = await reconcileClamshell(true);
    expect(setDisableSleep).toHaveBeenCalledTimes(1);
    expect(setDisableSleep).toHaveBeenCalledWith(true);
    expect(first.active).toBe(true);

    // Idempotent: a second desired reconcile does NOT re-run pmset.
    const second = await reconcileClamshell(true);
    expect(setDisableSleep).toHaveBeenCalledTimes(1);
    expect(second.active).toBe(true);
  });

  it("never enables when not desired (no toggle+mission)", async () => {
    const { platform, setDisableSleep } = makePlatform();
    __setClamshellPlatformForTest(platform);

    const status = await reconcileClamshell(false);
    expect(setDisableSleep).not.toHaveBeenCalled();
    expect(status.active).toBe(false);
  });
});

describe("clamshell reconcile — restore paths", () => {
  it("runs pmset disablesleep 0 on desired→false, but only because WE set it", async () => {
    const { platform, setDisableSleep } = makePlatform();
    __setClamshellPlatformForTest(platform);

    await reconcileClamshell(true); // engage → ours
    setDisableSleep.mockClear();

    const status = await reconcileClamshell(false); // release
    expect(setDisableSleep).toHaveBeenCalledTimes(1);
    expect(setDisableSleep).toHaveBeenCalledWith(false);
    expect(status.active).toBe(false);
  });

  it("does NOT restore when we never enabled it (only-restore-if-we-set-it)", async () => {
    const { platform, setDisableSleep } = makePlatform();
    __setClamshellPlatformForTest(platform);

    // Never engaged → nothing is ours → release is a no-op.
    await reconcileClamshell(false);
    await restoreClamshellOnQuit();
    expect(setDisableSleep).not.toHaveBeenCalled();
  });

  it("restores on quit when we hold the override", async () => {
    const { platform, setDisableSleep } = makePlatform();
    __setClamshellPlatformForTest(platform);

    await reconcileClamshell(true);
    setDisableSleep.mockClear();

    await restoreClamshellOnQuit();
    expect(setDisableSleep).toHaveBeenCalledTimes(1);
    expect(setDisableSleep).toHaveBeenCalledWith(false);
    expect(getClamshellStatus().active).toBe(false);
  });

  it("keeps the override marked ours if restore FAILS, so a later reconcile retries", async () => {
    const setDisableSleep = vi
      .fn(async (_disable: boolean) => undefined)
      // enable ok, restore throws, retry ok
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error("pmset boom");
      })
      .mockImplementationOnce(async () => undefined);
    __setClamshellPlatformForTest({
      setDisableSleep,
      isSleepDisabled: vi.fn(async () => false),
    });

    await reconcileClamshell(true); // enable
    const failed = await reconcileClamshell(false); // restore throws
    expect(failed.active).toBe(true); // still ours → retry allowed

    const retried = await reconcileClamshell(false); // retry restore
    expect(retried.active).toBe(false);
    expect(setDisableSleep).toHaveBeenCalledTimes(3);
  });
});

describe("clamshell reconcile — admin declined fallback", () => {
  it("falls back to idle-only (no throw) and reports adminDeclined when the prompt is cancelled", async () => {
    const setDisableSleep = vi.fn(async (disable: boolean) => {
      if (disable) throw new AdminDeclinedError();
    });
    __setClamshellPlatformForTest({
      setDisableSleep,
      isSleepDisabled: vi.fn(async () => false),
    });

    const status = await reconcileClamshell(true);
    expect(status.active).toBe(false);
    expect(status.adminDeclined).toBe(true);
    expect(status.supported).toBe(true);

    // Sticky within the engage cycle: a re-poll does NOT re-prompt.
    setDisableSleep.mockClear();
    await reconcileClamshell(true);
    expect(setDisableSleep).not.toHaveBeenCalled();

    // Cycling desired→false clears the decline so a fresh mission can re-prompt.
    await reconcileClamshell(false);
    expect(getClamshellStatus().adminDeclined).toBe(false);
  });

  it("detects osascript's user-cancel message as a decline (not a hard error)", async () => {
    const setDisableSleep = vi.fn(async (disable: boolean) => {
      if (disable) throw new Error("execution error: User canceled. (-128)");
    });
    __setClamshellPlatformForTest({
      setDisableSleep,
      isSleepDisabled: vi.fn(async () => false),
    });

    const status = await reconcileClamshell(true);
    expect(status.adminDeclined).toBe(true);
    expect(status.active).toBe(false);
  });
});

describe("clamshell boot safety reset", () => {
  it("clears a stale disablesleep left by a prior crash (reads state first)", async () => {
    const { platform, setDisableSleep, isSleepDisabled } = makePlatform({
      isSleepDisabled: vi.fn(async () => true),
    });
    __setClamshellPlatformForTest(platform);

    await bootSafetyResetClamshell();
    expect(isSleepDisabled).toHaveBeenCalledTimes(1);
    expect(setDisableSleep).toHaveBeenCalledTimes(1);
    expect(setDisableSleep).toHaveBeenCalledWith(false);
  });

  it("no-ops (no admin prompt) when sleep is already enabled on a healthy launch", async () => {
    const { platform, setDisableSleep, isSleepDisabled } = makePlatform({
      isSleepDisabled: vi.fn(async () => false),
    });
    __setClamshellPlatformForTest(platform);

    await bootSafetyResetClamshell();
    expect(isSleepDisabled).toHaveBeenCalledTimes(1);
    expect(setDisableSleep).not.toHaveBeenCalled();
  });

  it("skips the privileged clear when it cannot read the current state", async () => {
    const { platform, setDisableSleep } = makePlatform({
      isSleepDisabled: vi.fn(async () => {
        throw new Error("pmset unavailable");
      }),
    });
    __setClamshellPlatformForTest(platform);

    await bootSafetyResetClamshell();
    expect(setDisableSleep).not.toHaveBeenCalled();
  });
});

describe("clamshell — non-macOS guard", () => {
  it("is a hard no-op off macOS for every entry point", async () => {
    setPlatform("linux");
    const { platform, setDisableSleep, isSleepDisabled } = makePlatform({
      isSleepDisabled: vi.fn(async () => true),
    });
    __setClamshellPlatformForTest(platform);

    const engage = await reconcileClamshell(true);
    expect(engage).toEqual({ active: false, adminDeclined: false, supported: false });
    await reconcileClamshell(false);
    await restoreClamshellOnQuit();
    await bootSafetyResetClamshell();

    expect(setDisableSleep).not.toHaveBeenCalled();
    expect(isSleepDisabled).not.toHaveBeenCalled();
    expect(getClamshellStatus().supported).toBe(false);
  });
});
