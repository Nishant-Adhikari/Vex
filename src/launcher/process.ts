import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  LAUNCHER_DIR,
  LAUNCHER_PID_FILE,
  LAUNCHER_STOPPED_FILE,
} from "../config/paths.js";

export interface StopLauncherProcessOptions {
  timeoutMs?: number;
  pollMs?: number;
  writeStoppedFile?: boolean;
}

export interface StopLauncherProcessResult {
  status: "not_running" | "stale_pid" | "stopped" | "killed";
  pid: number | null;
}

export function readLauncherPid(): number | null {
  if (!existsSync(LAUNCHER_PID_FILE)) return null;

  try {
    const pid = Number.parseInt(readFileSync(LAUNCHER_PID_FILE, "utf-8").trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function removeLauncherPidFile(): void {
  try {
    if (existsSync(LAUNCHER_PID_FILE)) {
      unlinkSync(LAUNCHER_PID_FILE);
    }
  } catch {
    // Ignore cleanup errors.
  }
}

function writeLauncherStoppedMarker(): void {
  try {
    if (!existsSync(LAUNCHER_DIR)) {
      mkdirSync(LAUNCHER_DIR, { recursive: true });
    }
    writeFileSync(LAUNCHER_STOPPED_FILE, String(Date.now()), "utf-8");
  } catch {
    // Ignore marker write errors.
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopLauncherProcess(
  options: StopLauncherProcessOptions = {},
): Promise<StopLauncherProcessResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollMs = options.pollMs ?? 500;
  const writeStoppedFile = options.writeStoppedFile ?? false;
  const pid = readLauncherPid();

  if (pid == null) {
    removeLauncherPidFile();
    return { status: "not_running", pid: null };
  }

  if (!isPidAlive(pid)) {
    removeLauncherPidFile();
    return { status: "stale_pid", pid };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Fall through to polling/force-kill.
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (!isPidAlive(pid)) {
      removeLauncherPidFile();
      if (writeStoppedFile) {
        writeLauncherStoppedMarker();
      }
      return { status: "stopped", pid };
    }
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Ignore best-effort kill errors.
  }

  removeLauncherPidFile();
  if (writeStoppedFile) {
    writeLauncherStoppedMarker();
  }
  return { status: "killed", pid };
}
