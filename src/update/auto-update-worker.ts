import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { releaseUpdateLock } from "./updater.js";
import { markPackageAutoUpdated } from "./runtime-update-service.js";
import { isDaemonAlive, spawnLauncher } from "../utils/daemon-spawn.js";
import { stopLauncherProcess } from "../launcher/process.js";
import { LAUNCHER_PID_FILE } from "../config/paths.js";
import { readInstalledPackageVersion } from "./runtime-update-state.js";
import logger from "../utils/logger.js";

const NPM_PACKAGE_SPEC = "@echoclaw/echo@latest";
const UPDATE_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

export function installLatestPackage(): boolean {
  const result = spawnSync(
    "npm",
    ["install", "-g", NPM_PACKAGE_SPEC, "--no-fund", "--no-audit"],
    {
      stdio: "ignore",
      windowsHide: true,
      shell: process.platform === "win32",
      timeout: UPDATE_INSTALL_TIMEOUT_MS,
    },
  );

  if (result.error) {
    logger.warn(`Auto-update worker failed to install package: ${result.error.message}`);
    return false;
  }

  if ((result.status ?? 0) !== 0) {
    logger.warn(`Auto-update worker exited with npm status ${result.status ?? "unknown"}`);
    return false;
  }

  return true;
}

export async function restartLauncherIfRunning(): Promise<void> {
  if (!isDaemonAlive(LAUNCHER_PID_FILE)) {
    return;
  }

  const stopResult = await stopLauncherProcess({ writeStoppedFile: false });
  if (stopResult.status === "not_running" || stopResult.status === "stale_pid") {
    return;
  }

  const spawnResult = spawnLauncher();
  if (spawnResult.status === "spawn_failed") {
    logger.warn(`Auto-update worker failed to restart launcher: ${spawnResult.error}`);
  }
}

export async function runAutoUpdateWorker(): Promise<void> {
  try {
    if (!installLatestPackage()) {
      return;
    }

    const installedVersion = readInstalledPackageVersion();
    logger.info(`Auto-update installed echoclaw ${installedVersion}`);
    markPackageAutoUpdated(installedVersion);
    await restartLauncherIfRunning();
  } finally {
    releaseUpdateLock();
  }
}

export async function runAutoUpdateWorkerEntrypoint(): Promise<void> {
  try {
    await runAutoUpdateWorker();
  } catch (err) {
    handleAutoUpdateWorkerError(err);
  }
}

function isAutoUpdateWorkerEntrypoint(entryFile: string | undefined): boolean {
  if (!entryFile) {
    return false;
  }

  try {
    return resolve(entryFile) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isAutoUpdateWorkerEntrypoint(process.argv[1])) {
  void runAutoUpdateWorkerEntrypoint();
}

export function handleAutoUpdateWorkerError(err: unknown): void {
  logger.warn(`Auto-update worker failed: ${err instanceof Error ? err.message : String(err)}`);
  releaseUpdateLock();
  process.exitCode = 1;
}
