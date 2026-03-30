import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawnSync = vi.fn();
const mockReleaseUpdateLock = vi.fn();
const mockMarkPackageAutoUpdated = vi.fn();
const mockIsDaemonAlive = vi.fn();
const mockSpawnLauncher = vi.fn();
const mockStopLauncherProcess = vi.fn();
const mockReadInstalledPackageVersion = vi.fn();
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};

vi.mock("node:child_process", () => ({
  spawnSync: (...args: any[]) => mockSpawnSync(...args),
}));

vi.mock("../../update/updater.js", () => ({
  releaseUpdateLock: (...args: any[]) => mockReleaseUpdateLock(...args),
}));

vi.mock("../../update/runtime-update-service.js", () => ({
  markPackageAutoUpdated: (...args: any[]) => mockMarkPackageAutoUpdated(...args),
}));

vi.mock("@utils/daemon-spawn.js", () => ({
  isDaemonAlive: (...args: any[]) => mockIsDaemonAlive(...args),
  spawnLauncher: (...args: any[]) => mockSpawnLauncher(...args),
}));

vi.mock("../../launcher/process.js", () => ({
  stopLauncherProcess: (...args: any[]) => mockStopLauncherProcess(...args),
}));

vi.mock("@config/paths.js", () => ({
  LAUNCHER_PID_FILE: "/mock/launcher.pid",
}));

vi.mock("../../update/runtime-update-state.js", () => ({
  readInstalledPackageVersion: (...args: any[]) => mockReadInstalledPackageVersion(...args),
}));

vi.mock("@utils/logger.js", () => ({
  default: mockLogger,
}));

const {
  installLatestPackage,
  restartLauncherIfRunning,
  runAutoUpdateWorker,
  runAutoUpdateWorkerEntrypoint,
} = await import("../../update/auto-update-worker.js");

describe("auto-update worker", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    mockSpawnSync.mockReset().mockReturnValue({ status: 0, error: undefined });
    mockReleaseUpdateLock.mockReset();
    mockMarkPackageAutoUpdated.mockReset();
    mockIsDaemonAlive.mockReset().mockReturnValue(false);
    mockSpawnLauncher.mockReset().mockReturnValue({ status: "spawned", pid: 999, logFile: "/mock/launcher.log" });
    mockStopLauncherProcess.mockReset().mockResolvedValue({ status: "stopped", pid: 123 });
    mockReadInstalledPackageVersion.mockReset().mockReturnValue("2.0.0");
    for (const fn of Object.values(mockLogger)) {
      fn.mockReset();
    }
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("installs the latest package with the expected npm command", () => {
    expect(installLatestPackage()).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@echoclaw/echo@latest", "--no-fund", "--no-audit"],
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
      }),
    );
  });

  it("records the new package version and restarts a running launcher", async () => {
    mockIsDaemonAlive.mockReturnValue(true);

    await runAutoUpdateWorker();

    expect(mockMarkPackageAutoUpdated).toHaveBeenCalledWith("2.0.0");
    expect(mockStopLauncherProcess).toHaveBeenCalledWith({ writeStoppedFile: false });
    expect(mockSpawnLauncher).toHaveBeenCalledTimes(1);
    expect(mockReleaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith("Auto-update installed echoclaw 2.0.0");
  });

  it("does not restart the launcher when it is not running", async () => {
    mockIsDaemonAlive.mockReturnValue(false);

    await runAutoUpdateWorker();

    expect(mockStopLauncherProcess).not.toHaveBeenCalled();
    expect(mockSpawnLauncher).not.toHaveBeenCalled();
    expect(mockMarkPackageAutoUpdated).toHaveBeenCalledWith("2.0.0");
  });

  it("stops early when npm returns an error object", async () => {
    mockSpawnSync.mockReturnValue({ status: 0, error: new Error("spawn failed") });

    await runAutoUpdateWorker();

    expect(mockMarkPackageAutoUpdated).not.toHaveBeenCalled();
    expect(mockStopLauncherProcess).not.toHaveBeenCalled();
    expect(mockReleaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith("Auto-update worker failed to install package: spawn failed");
  });

  it("stops early when npm exits with a non-zero status", async () => {
    mockSpawnSync.mockReturnValue({ status: 1, error: undefined });

    await runAutoUpdateWorker();

    expect(mockMarkPackageAutoUpdated).not.toHaveBeenCalled();
    expect(mockStopLauncherProcess).not.toHaveBeenCalled();
    expect(mockReleaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith("Auto-update worker exited with npm status 1");
  });

  it.each([
    { status: "not_running", label: "not running anymore" },
    { status: "stale_pid", label: "stale pid" },
  ] as const)("skips launcher restart when stop result is $label", async ({ status }) => {
    mockIsDaemonAlive.mockReturnValue(true);
    mockStopLauncherProcess.mockResolvedValue({ status, pid: 123 });

    await restartLauncherIfRunning();

    expect(mockSpawnLauncher).not.toHaveBeenCalled();
  });

  it("warns but does not fail the worker when launcher respawn fails", async () => {
    mockIsDaemonAlive.mockReturnValue(true);
    mockSpawnLauncher.mockReturnValue({ status: "spawn_failed", error: "permission denied" });

    await runAutoUpdateWorker();

    expect(mockReleaseUpdateLock).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith("Auto-update worker failed to restart launcher: permission denied");
  });

  it("sets process.exitCode when the entrypoint catches an unexpected failure", async () => {
    mockReadInstalledPackageVersion.mockImplementation(() => {
      throw new Error("read failed");
    });

    await runAutoUpdateWorkerEntrypoint();

    expect(process.exitCode).toBe(1);
    expect(mockReleaseUpdateLock).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith("Auto-update worker failed: read failed");
  });
});
