/**
 * Docker daemon start — best-effort per OS:
 *   macOS  → `open -a Docker`
 *   Windows → `Start-Process "Docker Desktop"`
 *   Linux  → systemctl --user start docker-desktop, fallback to
 *             pkexec systemctl start docker
 *
 * Returns a `StartResult` describing what we attempted; the renderer
 * polls `vex.docker.detect()` afterwards to verify daemon comes up.
 */

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

async function startWindows(signal?: AbortSignal): Promise<StartResult> {
  // PowerShell handles spaces and admin elevation prompts for us.
  const result = await runSpawn(
    "powershell.exe",
    ["-Command", 'Start-Process -FilePath "Docker Desktop"'],
    { signal }
  );
  if (result.code !== 0) {
    return {
      kind: "failed",
      message: `PowerShell Start-Process failed (${result.code ?? "unknown"}).`,
    };
  }
  return {
    kind: "started",
    message: "Docker Desktop launching…",
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

  // Fall back to system docker daemon via pkexec (Docker Engine).
  const pkexec = await runSpawn(
    "pkexec",
    ["systemctl", "start", "docker"],
    { signal }
  );
  if (pkexec.code === 0) {
    return {
      kind: "started",
      message: "System docker daemon started via pkexec.",
    };
  }

  if (pkexec.code === 126) {
    return {
      kind: "user_action_required",
      message:
        "User cancelled the polkit prompt. Run `sudo systemctl start docker` from a terminal, then retry.",
    };
  }
  return {
    kind: "failed",
    message: `Could not start docker daemon (systemctl --user → ${userService.code ?? "?"}, pkexec → ${pkexec.code ?? "?"}).`,
  };
}
