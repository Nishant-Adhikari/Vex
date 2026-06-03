/**
 * Docker daemon start — best-effort per OS:
 *   macOS  → `open -a Docker`
 *   Windows → `docker desktop start` (CLI, GA in Docker Desktop 4.39+),
 *             falling back to launching the resolved `Docker Desktop.exe`
 *             detached via `Start-Process`.
 *   Linux  → systemctl --user start docker-desktop only. Docker Engine
 *             daemon startup requires user/admin action outside Vex.
 *
 * Returns a `StartResult` describing what we attempted; the renderer
 * polls `vex.docker.detect()` afterwards to verify daemon comes up.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { runSpawn } from "./spawn-runner.js";
import type { StartResult } from "@shared/schemas/docker.js";

export async function performStart(
  signal?: AbortSignal
): Promise<StartResult> {
  const platform = process.platform;
  if (platform === "darwin") return startMac(signal);
  if (platform === "win32") return startWindows(signal);
  if (platform === "linux") return startLinux(signal);
  return {
    kind: "unsupported",
    message: `Daemon start not implemented on ${platform}.`,
  };
}

async function startMac(signal?: AbortSignal): Promise<StartResult> {
  const result = await runSpawn("open", ["-a", "Docker"], { signal });
  if (result.code !== 0) {
    return {
      kind: "failed",
      message: `\`open -a Docker\` exited with ${result.code ?? "unknown"}.`,
    };
  }
  return {
    kind: "started",
    message:
      "Docker Desktop launching… it can take 30 seconds to be ready.",
  };
}

/** Readiness timeout (seconds) handed to `docker desktop start`. */
const DOCKER_DESKTOP_START_TIMEOUT_S = 120;

/**
 * Escape a value for safe embedding inside a PowerShell SINGLE-quoted
 * string literal — a literal single quote is doubled. Docker Desktop's
 * install path does not normally contain a quote, but resolving the exe
 * path and interpolating it into a `-Command` string must stay
 * injection-safe regardless.
 */
export function escapePowershellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Resolve the Docker Desktop GUI executable. Per-user install first
 * (Docker's currently recommended mode → `%LOCALAPPDATA%`), then the
 * all-users `%ProgramFiles%` location. Returns null when neither exists.
 */
export function resolveDockerDesktopExe(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const candidates: string[] = [];
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData && localAppData.length > 0) {
    candidates.push(
      path.join(localAppData, "Programs", "DockerDesktop", "Docker Desktop.exe")
    );
  }
  const programFiles = env["ProgramFiles"];
  if (programFiles && programFiles.length > 0) {
    candidates.push(
      path.join(programFiles, "Docker", "Docker", "Docker Desktop.exe")
    );
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function startWindows(signal?: AbortSignal): Promise<StartResult> {
  // Tier 1: the Docker Desktop CLI (`docker` is on PATH via
  // resources\bin). `docker desktop start` is GA since Docker Desktop
  // 4.39 (Mar 2025); with `--timeout` it WAITS for readiness and exits
  // non-zero on failure, so its exit code is authoritative. Both the CLI
  // `--timeout` and runSpawn.timeoutMs bound it so the flow cannot hang.
  const cli = await runSpawn(
    "docker",
    // `docker desktop start --timeout` expects numeric SECONDS (per
    // `docker desktop start --help`), not a Go duration string.
    ["desktop", "start", "--timeout", `${DOCKER_DESKTOP_START_TIMEOUT_S}`],
    {
      timeoutMs: (DOCKER_DESKTOP_START_TIMEOUT_S + 15) * 1000,
      ...(signal !== undefined ? { signal } : {}),
    }
  );
  if (cli.code === 0 && !cli.timedOut && !cli.aborted) {
    return {
      kind: "started",
      message: "Docker Desktop started via the Docker CLI.",
    };
  }
  if (cli.aborted) {
    return { kind: "failed", message: "Docker Desktop start was cancelled." };
  }
  // ONLY an older Docker Desktop without the `desktop` CLI plugin should
  // fall through to the GUI launch. A genuine start failure / timeout is
  // surfaced as a failure instead.
  const cliText = `${cli.stdout}\n${cli.stderr}`.toLowerCase();
  const cliUnsupported =
    !cli.timedOut &&
    /unknown command|is not a docker command|not a valid|no such command|usage:/.test(
      cliText
    );
  if (!cliUnsupported) {
    return {
      kind: "failed",
      message: cli.timedOut
        ? `\`docker desktop start\` did not become ready within ${DOCKER_DESKTOP_START_TIMEOUT_S}s.`
        : `\`docker desktop start\` exited with ${cli.code ?? "unknown"}${
            cli.stderr.trim()
              ? `: ${cli.stderr.split("\n").slice(-3).join(" ")}`
              : ""
          }`,
    };
  }

  // Tier 2: launch the GUI exe by RESOLVED FULL PATH, DETACHED via
  // Start-Process (ShellExecute). runSpawn uses piped, non-detached
  // stdio, so spawning the GUI directly would keep it as a child and
  // block the readiness poll. The path is escaped for the single-quoted
  // PowerShell literal.
  const exe = resolveDockerDesktopExe();
  if (exe === null) {
    return {
      kind: "failed",
      message:
        "Could not locate Docker Desktop.exe (looked under %LOCALAPPDATA%\\Programs\\DockerDesktop and %ProgramFiles%\\Docker\\Docker). Is Docker Desktop installed?",
    };
  }
  const psCommand = `Start-Process -FilePath '${escapePowershellSingleQuoted(
    exe
  )}'`;
  const launch = await runSpawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psCommand],
    signal !== undefined ? { signal } : {}
  );
  if (launch.code !== 0) {
    return {
      kind: "failed",
      message: `Launching Docker Desktop failed (${launch.code ?? "unknown"})${
        launch.stderr.trim()
          ? `: ${launch.stderr.split("\n").slice(-3).join(" ")}`
          : ""
      }.`,
    };
  }
  return {
    kind: "started",
    message: "Docker Desktop launching… it can take ~30 seconds to be ready.",
  };
}

async function startLinux(signal?: AbortSignal): Promise<StartResult> {
  // Try the user-level service first (Docker Desktop on Linux).
  const userService = await runSpawn(
    "systemctl",
    ["--user", "start", "docker-desktop"],
    { signal }
  );
  if (userService.code === 0) {
    return {
      kind: "started",
      message: "Docker Desktop user service started.",
    };
  }

  return {
    kind: "user_action_required",
    message:
      "Vex cannot start the system Docker Engine daemon. Start Docker from your system tools or run `sudo systemctl start docker` in a terminal, then retry.",
  };
}
