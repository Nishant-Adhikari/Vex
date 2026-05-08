/**
 * Docker install handler — coordinates 3 methods × 3 platforms.
 *
 *   desktop_download       → macOS/Windows: download installer to user's
 *                            Downloads folder + open it (user runs admin
 *                            install). We never auto-elevate for desktop.
 *   linux_apt_auto         → Linux: pkexec-driven apt install of docker-ce
 *                            + compose + model plugin. Auto-degrades to
 *                            `linux_manual_instructions` on polkit failure
 *                            (codex turn 4 YELLOW #5).
 *   linux_manual_instructions → returns a copy-paste block per distro;
 *                               renderer renders the block.
 *
 * Progress events flow through `dockerProgressBus` so the renderer can
 * stream them via the typed `vex.docker.onInstallProgress` subscription.
 */

import { app, net, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runSpawn } from "./spawn-runner.js";
import { dockerProgressBus } from "./progress-bus.js";
import {
  getInstallerForPlatform,
  isAllowedInstallerUrl,
} from "./installer-urls.js";
import type { InstallMethod, InstallResult } from "@shared/schemas/docker.js";

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000; // 10 minutes for slow networks

interface InstallContext {
  readonly signal?: AbortSignal;
}

export async function performInstall(
  method: InstallMethod,
  ctx: InstallContext = {}
): Promise<InstallResult> {
  if (method === "desktop_download") return performDesktopDownload(ctx);
  if (method === "linux_apt_auto") return performLinuxAutoInstall(ctx);
  if (method === "linux_manual_instructions") return buildLinuxManualInstructions();
  return {
    kind: "unsupported",
    message: `Unknown install method: ${method as string}`,
    artifactPath: null,
    fallbackInstructions: null,
  };
}

async function performDesktopDownload(ctx: InstallContext): Promise<InstallResult> {
  const platform = process.platform;
  const arch = process.arch;
  const entry = getInstallerForPlatform(platform, arch);
  if (!entry) {
    return {
      kind: "unsupported",
      message: `Desktop download unsupported on ${platform}/${arch}.`,
      artifactPath: null,
      fallbackInstructions: null,
    };
  }
  if (!isAllowedInstallerUrl(entry.url)) {
    return {
      kind: "failed",
      message: "Installer URL failed allowlist check.",
      artifactPath: null,
      fallbackInstructions: null,
    };
  }

  const downloadsDir = app.getPath("downloads");
  await fs.mkdir(downloadsDir, { recursive: true });
  const target = path.join(downloadsDir, entry.filename);

  dockerProgressBus.emit({
    phase: "starting",
    message: `Downloading ${entry.filename}…`,
    percent: 0,
  });

  try {
    await downloadInstaller(entry.url, target, ctx.signal);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Download failed.";
    dockerProgressBus.emit({ phase: "failed", message, percent: null });
    return {
      kind: "failed",
      message,
      artifactPath: null,
      fallbackInstructions: null,
    };
  }

  dockerProgressBus.emit({
    phase: "verifying",
    message: "Opening installer…",
    percent: 100,
  });

  try {
    await shell.openPath(target);
  } catch {
    // open failure is non-fatal — user can run the file manually
  }

  dockerProgressBus.emit({
    phase: "completed",
    message: `Run ${entry.filename} from your Downloads folder to finish install.`,
    percent: 100,
  });

  return {
    kind: "completed",
    message: `Installer downloaded to ${target}. Run it to finish setup.`,
    artifactPath: target,
    fallbackInstructions: null,
  };
}

async function downloadInstaller(
  url: string,
  destination: string,
  signal?: AbortSignal
): Promise<void> {
  const ac = new AbortController();
  const linked = (): void => ac.abort();
  signal?.addEventListener("abort", linked, { once: true });
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await net.fetch(url, { signal: ac.signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download HTTP ${response.status}`);
    }
    const totalHeader = response.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : null;
    let received = 0;

    const reader = response.body.getReader();
    const handle = await fs.open(destination, "w");
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await handle.write(value);
        received += value.byteLength;
        if (total) {
          dockerProgressBus.emit({
            phase: "downloading",
            message: `Downloaded ${formatBytes(received)} of ${formatBytes(total)}`,
            percent: Math.min(100, Math.round((received / total) * 100)),
          });
        } else {
          dockerProgressBus.emit({
            phase: "downloading",
            message: `Downloaded ${formatBytes(received)}`,
            percent: null,
          });
        }
      }
    } finally {
      await handle.close();
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", linked);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type LinuxDistro = "ubuntu" | "debian";

async function detectSupportedDistro(): Promise<LinuxDistro | null> {
  try {
    const content = await fs.readFile("/etc/os-release", "utf8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      const sep = line.indexOf("=");
      if (sep < 1) continue;
      if (line.slice(0, sep) !== "ID") continue;
      const value = line.slice(sep + 1).replace(/^"|"$/g, "").toLowerCase();
      if (value === "ubuntu" || value === "debian") return value;
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

async function performLinuxAutoInstall(ctx: InstallContext): Promise<InstallResult> {
  if (process.platform !== "linux") {
    return {
      kind: "unsupported",
      message: "Linux apt auto-install is only available on Linux.",
      artifactPath: null,
      fallbackInstructions: null,
    };
  }

  // Codex turn 5 RED #5 — script must use the right docker.com repo path
  // for the host distro (Ubuntu uses /linux/ubuntu, Debian uses /linux/debian).
  const distro = await detectSupportedDistro();
  if (distro === null) {
    const manual = buildLinuxManualInstructions();
    return {
      kind: "degraded",
      message:
        "Unsupported Linux distro for auto-install (need Ubuntu or Debian). Falling back to guided manual install.",
      artifactPath: null,
      fallbackInstructions: manual.fallbackInstructions,
    };
  }

  // Detect if pkexec is available; if not, immediately degrade to manual.
  const pkexecCheck = await runSpawn("which", ["pkexec"], { signal: ctx.signal });
  if (pkexecCheck.code !== 0) {
    const manual = buildLinuxManualInstructions();
    return {
      kind: "degraded",
      message: "pkexec is not installed — falling back to guided manual install.",
      artifactPath: null,
      fallbackInstructions: manual.fallbackInstructions,
    };
  }

  dockerProgressBus.emit({
    phase: "starting",
    message: "Authenticating with PolicyKit…",
    percent: null,
  });

  // Run a tiny pkexec sanity check (e.g. `true`) so polkit prompts upfront.
  const auth = await runSpawn("pkexec", ["true"], {
    signal: ctx.signal,
    onStdoutLine: (line) =>
      dockerProgressBus.emit({ phase: "installing", message: line, percent: null }),
    onStderrLine: (line) =>
      dockerProgressBus.emit({ phase: "installing", message: line, percent: null }),
  });

  if (auth.code !== 0) {
    const reason = describePkexecExit(auth.code, auth.stderr);
    const manual = buildLinuxManualInstructions();
    return {
      kind: "degraded",
      message: `pkexec authentication failed (${reason}) — falling back to guided manual install.`,
      artifactPath: null,
      fallbackInstructions: manual.fallbackInstructions,
    };
  }

  // Authenticated; run the docker-ce install script for the detected distro.
  const installScript = buildAptInstallScript(distro);
  const result = await runSpawn(
    "pkexec",
    ["sh", "-c", installScript],
    {
      signal: ctx.signal,
      onStdoutLine: (line) =>
        dockerProgressBus.emit({ phase: "installing", message: line, percent: null }),
      onStderrLine: (line) =>
        dockerProgressBus.emit({ phase: "installing", message: line, percent: null }),
    }
  );

  if (result.code !== 0) {
    const manual = buildLinuxManualInstructions();
    return {
      kind: "degraded",
      message: `apt install exited with code ${result.code ?? "unknown"}. Falling back to guided manual install.`,
      artifactPath: null,
      fallbackInstructions: manual.fallbackInstructions,
    };
  }

  dockerProgressBus.emit({
    phase: "completed",
    message: "Docker Engine installed. Log out and back in to apply group changes.",
    percent: 100,
  });
  return {
    kind: "completed",
    message:
      "Docker Engine installed. Log out and log back in (or reboot) so the docker group takes effect.",
    artifactPath: null,
    fallbackInstructions: null,
  };
}

function describePkexecExit(code: number | null, stderr: string): string {
  if (code === 126) return "user cancelled";
  if (code === 127) return "polkit unavailable";
  if (/not authorized/i.test(stderr)) return "not authorized";
  return `exit code ${code ?? "unknown"}`;
}

function buildAptInstallScript(distro: LinuxDistro): string {
  // Mirrors docker.com's apt repo bootstrap — keep idempotent, fail-fast.
  // Distro path picks the right keyring + signed-by + repo URL. Ubuntu and
  // Debian have separate package manifests on docker.com.
  return [
    "set -euo pipefail",
    "apt-get update",
    "apt-get install -y ca-certificates curl gnupg",
    "install -m 0755 -d /etc/apt/keyrings",
    `curl -fsSL https://download.docker.com/linux/${distro}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg`,
    "chmod a+r /etc/apt/keyrings/docker.gpg",
    `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list`,
    "apt-get update",
    "apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
    "usermod -aG docker ${SUDO_USER:-${USER:-$(id -un)}}",
  ].join("\n");
}

function buildLinuxManualInstructions(): InstallResult {
  return {
    kind: "guided",
    message: "Follow the official Docker Engine install instructions for your distro.",
    artifactPath: null,
    fallbackInstructions: [
      "# Debian / Ubuntu (docker.com official repo)",
      "# IMPORTANT: replace `<distro>` with `debian` or `ubuntu` to match your host.",
      "sudo apt-get update",
      "sudo apt-get install -y ca-certificates curl gnupg",
      "sudo install -m 0755 -d /etc/apt/keyrings",
      "curl -fsSL https://download.docker.com/linux/<distro>/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg",
      "sudo chmod a+r /etc/apt/keyrings/docker.gpg",
      "echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/<distro> $(. /etc/os-release && echo $VERSION_CODENAME) stable\" | sudo tee /etc/apt/sources.list.d/docker.list",
      "sudo apt-get update",
      "sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
      "sudo usermod -aG docker $USER",
      "# After install: LOG OUT and back in (or reboot) so the docker group is applied to your session.",
    ].join("\n"),
  };
}
