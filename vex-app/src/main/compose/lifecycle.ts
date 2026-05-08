/**
 * Compose up/down lifecycle. Pre-flight port check + label-based reuse
 * detection (codex turn 4 YELLOW #6 — `docker ps --filter label=...`,
 * NOT `docker compose ls`). composeDown uses `stop`, never
 * `down --volumes` (skill §10).
 */

import { runSpawn } from "../docker/spawn-runner.js";
import { isPortFree } from "../docker/probe.js";
import { renderCompose, type RenderDeps } from "./render.js";

const DEFAULT_PG_PORT = 55432;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 60_000;

export type ComposeUpKind =
  | "running"
  | "reused"
  | "port_collision"
  | "unhealthy"
  | "failed";

export interface ComposeUpResult {
  readonly kind: ComposeUpKind;
  readonly composeOutPath: string;
  readonly installId: string;
  readonly message: string;
}

export type ComposeDownKind = "stopped" | "not_running" | "failed";

export interface ComposeDownResult {
  readonly kind: ComposeDownKind;
  readonly message: string;
}

export interface ComposeUpOptions {
  readonly pgPort?: number;
  readonly signal?: AbortSignal;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

async function isOurProjectActive(
  installId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const project = `vex-${installId}`;
  // `docker ps --filter label=com.docker.compose.project=...` is the
  // skill-recommended detection (label survives daemon restarts; less
  // brittle than parsing `docker compose ls` JSON).
  const result = await runSpawn(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--format",
      "{{.ID}}",
    ],
    { signal }
  );
  if (result.code !== 0) return false;
  return result.stdout.trim().length > 0;
}

async function probeDbHealth(
  composeOutPath: string,
  installId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const project = `vex-${installId}`;
  const result = await runSpawn(
    "docker",
    [
      "compose",
      "-f",
      composeOutPath,
      "-p",
      project,
      "exec",
      "-T",
      "db",
      "pg_isready",
      "-U",
      "vex",
      "-d",
      "vex",
    ],
    { signal }
  );
  return result.code === 0;
}

async function waitForHealth(
  composeOutPath: string,
  installId: string,
  signal?: AbortSignal
): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    if (await probeDbHealth(composeOutPath, installId, signal)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

export async function composeUp(
  deps: RenderDeps,
  options: ComposeUpOptions = {}
): Promise<ComposeUpResult> {
  const { signal, onLogLine, pgPort = DEFAULT_PG_PORT } = options;

  const rendered = await renderCompose(deps, { pgPort });

  // Pre-flight: is the host port free?
  const portFree = await isPortFree("127.0.0.1", pgPort, signal);
  if (!portFree) {
    const ourStack = await isOurProjectActive(rendered.installId, signal);
    if (ourStack) {
      const healthy = await waitForHealth(rendered.outPath, rendered.installId, signal);
      return {
        kind: healthy ? "reused" : "unhealthy",
        composeOutPath: rendered.outPath,
        installId: rendered.installId,
        message: healthy
          ? `Reusing existing vex-${rendered.installId} compose project on :${pgPort}.`
          : `Existing vex stack found but DB is not yet healthy. Try Retry detection.`,
      };
    }
    return {
      kind: "port_collision",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `Port ${pgPort} is occupied by a different process. Stop the conflicting service or pick another port in Settings → Advanced.`,
    };
  }

  const upResult = await runSpawn(
    "docker",
    ["compose", "-f", rendered.outPath, "up", "-d"],
    {
      signal,
      onStdoutLine: (line) => onLogLine?.("stdout", line),
      onStderrLine: (line) => onLogLine?.("stderr", line),
    }
  );

  if (upResult.code !== 0) {
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `\`docker compose up -d\` exited with ${upResult.code ?? "unknown"}.`,
    };
  }

  const healthy = await waitForHealth(rendered.outPath, rendered.installId, signal);
  return {
    kind: healthy ? "running" : "unhealthy",
    composeOutPath: rendered.outPath,
    installId: rendered.installId,
    message: healthy
      ? `Vex stack vex-${rendered.installId} is running on :${pgPort}.`
      : `Stack started but pg_isready did not respond within ${HEALTH_TIMEOUT_MS / 1000}s.`,
  };
}

export async function composeDown(
  composeOutPath: string,
  installId: string,
  signal?: AbortSignal
): Promise<ComposeDownResult> {
  const project = `vex-${installId}`;
  const result = await runSpawn(
    "docker",
    ["compose", "-f", composeOutPath, "-p", project, "stop"],
    { signal }
  );
  if (result.code === 0) {
    return { kind: "stopped", message: `Stopped vex-${installId} compose project.` };
  }
  // `docker compose stop` returns 0 even if the project is already
  // stopped — a non-zero code therefore signals an actual failure.
  if (/no such project|not found/i.test(result.stderr)) {
    return { kind: "not_running", message: "Project was not running." };
  }
  return {
    kind: "failed",
    message: `\`docker compose stop\` exited with ${result.code ?? "unknown"}.`,
  };
}
