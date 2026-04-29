import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { VexError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { runCommand } from "../shared/process.js";
import { confirm, renderSection } from "./ui.js";

type SupportedLinuxDistro = "ubuntu" | "debian";

interface OsReleaseInfo {
  id?: string;
  versionCodename?: string;
  ubuntuCodename?: string;
}

interface DockerDesktopFallback {
  title: string;
  docsUrl: string;
  steps: string[];
}

function stripQuotes(value: string): string {
  return value.replace(/^"/, "").replace(/"$/, "");
}

export function parseOsRelease(content: string): OsReleaseInfo {
  const info: OsReleaseInfo = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator);
    const value = stripQuotes(line.slice(separator + 1).trim());

    if (key === "ID") info.id = value.toLowerCase();
    if (key === "VERSION_CODENAME") info.versionCodename = value;
    if (key === "UBUNTU_CODENAME") info.ubuntuCodename = value;
  }

  return info;
}

export function getSupportedLinuxDistro(osReleasePath: string = "/etc/os-release"): SupportedLinuxDistro | null {
  if (platform() !== "linux" || !existsSync(osReleasePath)) {
    return null;
  }

  const content = readFileSync(osReleasePath, "utf-8");
  const info = parseOsRelease(content);
  return info.id === "ubuntu" || info.id === "debian" ? info.id : null;
}

function getLinuxCodename(osReleasePath: string = "/etc/os-release"): string | null {
  if (!existsSync(osReleasePath)) {
    return null;
  }

  const info = parseOsRelease(readFileSync(osReleasePath, "utf-8"));
  return info.ubuntuCodename ?? info.versionCodename ?? null;
}

function getDockerArchitecture(): string {
  const current = arch();
  if (current === "x64") return "amd64";
  if (current === "arm64") return "arm64";
  return current;
}

function buildDockerSourcesFile(distro: SupportedLinuxDistro, codename: string): string {
  return [
    "Types: deb",
    `URIs: https://download.docker.com/linux/${distro}`,
    `Suites: ${codename}`,
    "Components: stable",
    `Architectures: ${getDockerArchitecture()}`,
    "Signed-By: /etc/apt/keyrings/docker.asc",
    "",
  ].join("\n");
}

function runSudoStep(command: string, args: readonly string[], input?: string): void {
  const result = spawnSync("sudo", [command, ...args], {
    stdio: ["pipe", "inherit", "inherit"],
    input,
    encoding: "utf-8",
  });

  if (result.error || result.status !== 0) {
    throw new VexError(
      ErrorCodes.SYSTEM_CHECK_FAILED,
      `Failed to run: sudo ${command} ${args.join(" ")}`.trim(),
      result.error?.message ?? "Docker installation did not finish successfully.",
    );
  }
}

function installDockerEnginePackageSet(distro: SupportedLinuxDistro, codename: string): void {
  const gpgUrl = `https://download.docker.com/linux/${distro}/gpg`;
  const sourcesFile = buildDockerSourcesFile(distro, codename);

  renderSection(
    "Docker install",
    `Installing Docker Engine, Compose, and Docker Model Runner plugin for ${distro}.`,
  );

  runSudoStep("apt-get", ["update"]);
  runSudoStep("apt-get", ["install", "-y", "ca-certificates", "curl"]);
  runSudoStep("install", ["-m", "0755", "-d", "/etc/apt/keyrings"]);
  runSudoStep("curl", ["-fsSL", gpgUrl, "-o", "/etc/apt/keyrings/docker.asc"]);
  runSudoStep("chmod", ["a+r", "/etc/apt/keyrings/docker.asc"]);
  runSudoStep("tee", ["/etc/apt/sources.list.d/docker.sources"], sourcesFile);
  runSudoStep("apt-get", ["update"]);
  runSudoStep("apt-get", [
    "install",
    "-y",
    "docker-ce",
    "docker-ce-cli",
    "containerd.io",
    "docker-buildx-plugin",
    "docker-compose-plugin",
    "docker-model-plugin",
  ]);
}

function addCurrentUserToDockerGroup(): boolean {
  const username = process.env.SUDO_USER ?? process.env.USER;
  if (!username) {
    return false;
  }

  runSudoStep("usermod", ["-aG", "docker", username]);
  return true;
}

function getDesktopFallback(): DockerDesktopFallback | null {
  if (platform() === "win32") {
    return {
      title: "Docker Desktop for Windows",
      docsUrl: "https://docs.docker.com/desktop/setup/install/windows-install/",
      steps: [
        "Install Docker Desktop using the official Windows installer flow from Docker Docs.",
        "After installation, open Docker Desktop and enable Docker Model Runner.",
        "Restart the launcher after Docker Desktop reports that it is running.",
      ],
    };
  }

  if (platform() === "darwin") {
    return {
      title: "Docker Desktop for macOS",
      docsUrl: "https://docs.docker.com/desktop/setup/install/mac-install/",
      steps: [
        "Install Docker Desktop using the official macOS installer flow from Docker Docs.",
        "After installation, open Docker Desktop and enable Docker Model Runner.",
        "Restart the launcher after Docker Desktop reports that it is running.",
      ],
    };
  }

  return null;
}

function printManualDockerInstructions(): never {
  const fallback = getDesktopFallback();

  renderSection(
    "Docker required",
    "Vex needs Docker, Docker Compose, and Docker Model Runner before the local MCP can start.",
  );

  if (fallback) {
    writeStderr(`${fallback.title}: ${fallback.docsUrl}`);
    for (const step of fallback.steps) {
      writeStderr(`- ${step}`);
    }
  } else {
    writeStderr("Official Docker install docs: https://docs.docker.com/engine/install/");
    writeStderr("- Install Docker using the official guide for your platform.");
    writeStderr("- Ensure Docker Compose is available.");
    writeStderr("- Install or enable Docker Model Runner before rerunning `vex setup`.");
  }

  throw new VexError(
    ErrorCodes.SYSTEM_CHECK_FAILED,
    "Docker is not installed.",
    "Install Docker and rerun `vex setup`.",
  );
}

export async function maybeInstallDockerWhenMissing(dockerDetail: string): Promise<never> {
  const distro = getSupportedLinuxDistro();

  if (distro == null) {
    printManualDockerInstructions();
  }

  const codename = getLinuxCodename();
  if (!codename) {
    throw new VexError(
      ErrorCodes.SYSTEM_CHECK_FAILED,
      "Unable to detect the Linux release codename needed for Docker installation.",
      "Install Docker manually using the official Docker Engine docs for your distro.",
    );
  }

  renderSection(
    "Docker missing",
    dockerDetail || "Docker is required to run the local Postgres and embeddings proxy stack.",
  );

  const shouldInstall = await confirm(
    `Docker is not installed. Do you want Vex to install Docker Engine for ${distro} now?`,
    true,
  );

  if (!shouldInstall) {
    printManualDockerInstructions();
  }

  installDockerEnginePackageSet(distro, codename);
  const addedToGroup = addCurrentUserToDockerGroup();

  throw new VexError(
    ErrorCodes.SYSTEM_CHECK_FAILED,
    "Docker was installed successfully, but the current shell session must be refreshed before Vex can use it.",
    addedToGroup
      ? "Sign out and back in, or start a fresh terminal session, then rerun `vex setup`."
      : "Start a fresh terminal session, then rerun `vex setup`.",
  );
}

export async function maybeInstallDockerModelPluginWhenMissing(modelRunnerDetail: string): Promise<boolean> {
  const distro = getSupportedLinuxDistro();
  if (distro == null || !isDockerModelPluginMissing(modelRunnerDetail)) {
    return false;
  }

  const shouldInstall = await confirm(
    "Docker Model Runner plugin is missing. Do you want Vex to install it now?",
    true,
  );

  if (!shouldInstall) {
    return false;
  }

  renderSection(
    "Docker Model Runner",
    "Installing the official Docker Model Runner plugin for Docker Engine.",
  );

  runSudoStep("apt-get", ["update"]);
  runSudoStep("apt-get", ["install", "-y", "docker-model-plugin"]);
  const installRunner = runCommand("docker", ["model", "install-runner"]);

  if (!installRunner.ok) {
    writeStderr("Docker Model Runner plugin was installed. Vex will re-run the system checks next.");
  }

  return true;
}

export function isDockerMissing(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return normalized.includes("enoent") || normalized.includes("not found");
}

export function isDockerModelPluginMissing(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return normalized.includes("'model' is not a docker command")
    || normalized.includes("\"model\" is not a docker command");
}
