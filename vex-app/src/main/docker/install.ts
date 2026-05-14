/**
 * Docker install handler — coordinates 3 methods × 3 platforms.
 *
 *   desktop_download       → macOS/Windows: download installer to user's
 *                            Downloads folder + open it (user runs admin
 *                            install). We never auto-elevate for desktop.
 *   linux_manual_instructions → returns a copy-paste block per distro;
 *                               renderer renders the block.
 *
 * Progress events flow through `dockerProgressBus` so the renderer can
 * stream them via the typed `vex.docker.onInstallProgress` subscription.
 */

import { app, net, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
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
