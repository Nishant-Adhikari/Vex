import { spawnSync } from "node:child_process";
import { REQUIRED_ENV, runBootstrapChecks } from "../../mcp/bootstrap.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import { runCommand, sleep } from "../shared/process.js";
import {
  isDockerMissing,
  maybeInstallDockerModelPluginWhenMissing,
  maybeInstallDockerWhenMissing,
} from "./docker.js";
import { formatLauncherError } from "./errors.js";
import { getDockerComposeDevPath } from "./package-assets.js";
import { synchronizeTrackedEnv } from "./setup.js";
import { renderSection, renderSystemChecks } from "./ui.js";

export interface SystemCheckResult {
  label: string;
  ok: boolean;
  detail: string;
  rawDetail?: string;
}

export function collectSystemChecks(): SystemCheckResult[] {
  const checks: SystemCheckResult[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");

  checks.push({
    label: "Node.js 22+",
    ok: nodeMajor >= 22,
    detail: `Detected Node.js ${process.versions.node}.`,
  });

  const docker = runCommand("docker", ["--version"]);
  checks.push({
    label: "Docker",
    ok: docker.ok,
    detail: docker.ok ? docker.detail : "Docker is required to run the local Postgres and embeddings proxy stack.",
    rawDetail: docker.detail,
  });

  const compose = runCommand("docker", ["compose", "version"]);
  checks.push({
    label: "Docker Compose",
    ok: compose.ok,
    detail: compose.ok ? compose.detail : "Docker Compose is required to start the bundled local stack.",
    rawDetail: compose.detail,
  });

  const modelRunner = runCommand("docker", ["model", "status"]);
  checks.push({
    label: "Docker Model Runner",
    ok: modelRunner.ok,
    detail: modelRunner.ok
      ? modelRunner.detail
      : "Docker Model Runner must be enabled before local MCP bootstrap can pass.",
    rawDetail: modelRunner.detail,
  });

  return checks;
}

function findCheck(
  checks: readonly SystemCheckResult[],
  label: SystemCheckResult["label"],
): SystemCheckResult | undefined {
  return checks.find((check) => check.label === label);
}

export async function ensureSystemChecksPassed(): Promise<void> {
  let checks = collectSystemChecks();
  renderSystemChecks(checks);

  const dockerCheck = findCheck(checks, "Docker");
  if (dockerCheck && !dockerCheck.ok && isDockerMissing(dockerCheck.rawDetail ?? dockerCheck.detail)) {
    await maybeInstallDockerWhenMissing(dockerCheck.rawDetail ?? dockerCheck.detail);
  }

  const modelRunnerCheck = findCheck(checks, "Docker Model Runner");
  if (modelRunnerCheck && !modelRunnerCheck.ok) {
    const repaired = await maybeInstallDockerModelPluginWhenMissing(
      modelRunnerCheck.rawDetail ?? modelRunnerCheck.detail,
    );
    if (repaired) {
      checks = collectSystemChecks();
      renderSystemChecks(checks);
    }
  }

  const failing = checks.find((check) => !check.ok);
  if (!failing) return;

  throw new VexError(
    ErrorCodes.SYSTEM_CHECK_FAILED,
    `${failing.label} check failed.`,
    failing.detail,
  );
}

export async function waitForBootstrapSuccess(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      synchronizeTrackedEnv();
      await runBootstrapChecks();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        writeStderr(`Bootstrap check not ready yet. Retrying (${attempt}/3)...`);
        await sleep(2000);
      }
    }
  }

  throw new VexError(
    ErrorCodes.LAUNCHER_START_FAILED,
    "Local MCP bootstrap failed after starting services.",
    formatLauncherError(lastError),
  );
}

export function startLocalServices(): void {
  renderSection(
    "Local services",
    "Starting the bundled local Postgres + embeddings proxy stack used by Vex MCP.",
  );

  const composeFile = getDockerComposeDevPath();
  const result = spawnSync("docker", ["compose", "-f", composeFile, "up", "-d"], {
    encoding: "utf-8",
  });

  if (!result.error && result.status === 0) {
    writeStderr("Local services started.");
    return;
  }

  const commandOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const detail = result.error?.message ?? commandOutput;
  const fallbackDetail = `docker compose up -d failed. Required env keys: ${REQUIRED_ENV.join(", ")}`;

  throw new VexError(
    ErrorCodes.LAUNCHER_START_FAILED,
    "Failed to start local services.",
    detail || fallbackDetail,
  );
}
