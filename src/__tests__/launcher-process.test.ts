import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadLauncherProcessModule(root: string) {
  vi.resetModules();
  vi.doMock("../config/paths.js", () => ({
    LAUNCHER_DIR: root,
    LAUNCHER_PID_FILE: join(root, "launcher.pid"),
    LAUNCHER_STOPPED_FILE: join(root, "launcher.stopped"),
  }));

  const module = await import("../launcher/process.js");
  return {
    ...module,
    pidFile: join(root, "launcher.pid"),
    stoppedFile: join(root, "launcher.stopped"),
  };
}

describe.sequential("launcher process control", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("treats an invalid pid file as not running and cleans it up", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-launcher-process-"));
    const { stopLauncherProcess, pidFile } = await loadLauncherProcessModule(root);
    writeFileSync(pidFile, "not-a-pid", "utf-8");

    try {
      const result = await stopLauncherProcess();

      expect(result).toEqual({ status: "not_running", pid: null });
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns stale_pid when the recorded launcher pid is no longer alive", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-launcher-process-"));
    const { stopLauncherProcess, pidFile } = await loadLauncherProcessModule(root);
    writeFileSync(pidFile, "4321", "utf-8");
    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 && pid === 4321) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    try {
      const result = await stopLauncherProcess();

      expect(result).toEqual({ status: "stale_pid", pid: 4321 });
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gracefully stops the launcher and writes the stopped marker when requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-launcher-process-"));
    const { stopLauncherProcess, pidFile, stoppedFile } = await loadLauncherProcessModule(root);
    writeFileSync(pidFile, "5432", "utf-8");
    vi.useFakeTimers();

    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid !== 5432) {
        return true;
      }
      if (signal === 0) {
        if (!alive) {
          throw new Error("ESRCH");
        }
        return true;
      }
      if (signal === "SIGTERM") {
        alive = false;
      }
      return true;
    }) as typeof process.kill);

    try {
      const stopPromise = stopLauncherProcess({ timeoutMs: 1_000, pollMs: 100, writeStoppedFile: true });
      await vi.advanceTimersByTimeAsync(100);
      const result = await stopPromise;

      expect(result).toEqual({ status: "stopped", pid: 5432 });
      expect(killSpy).toHaveBeenCalledWith(5432, "SIGTERM");
      expect(existsSync(pidFile)).toBe(false);
      expect(existsSync(stoppedFile)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("force-kills the launcher after the timeout expires", async () => {
    const root = mkdtempSync(join(tmpdir(), "echoclaw-launcher-process-"));
    const { stopLauncherProcess, pidFile, stoppedFile } = await loadLauncherProcessModule(root);
    writeFileSync(pidFile, "6543", "utf-8");
    vi.useFakeTimers();

    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid !== 6543) {
        return true;
      }
      if (signal === 0 || signal === "SIGTERM" || signal === "SIGKILL") {
        return true;
      }
      return true;
    }) as typeof process.kill);

    try {
      const stopPromise = stopLauncherProcess({ timeoutMs: 300, pollMs: 100, writeStoppedFile: true });
      await vi.advanceTimersByTimeAsync(300);
      const result = await stopPromise;

      expect(result).toEqual({ status: "killed", pid: 6543 });
      expect(killSpy).toHaveBeenCalledWith(6543, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(6543, "SIGKILL");
      expect(existsSync(pidFile)).toBe(false);
      expect(Number(readFileSync(stoppedFile, "utf-8"))).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
