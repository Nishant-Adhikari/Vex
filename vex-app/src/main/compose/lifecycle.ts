/**
 * Compose up/down lifecycle. Pre-flight port check + label-based reuse
 * detection (codex turn 4 YELLOW #6 — `docker ps --filter label=...`,
 * NOT `docker compose ls`). composeDown uses `stop`, never
 * `down --volumes` (skill §10).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { runSpawn } from "../docker/spawn-runner.js";
import { isPortFree } from "../docker/probe.js";
import { ensureDockerDaemonReady } from "../docker/daemon.js";
import { pgConnectProbe } from "./pg-health.js";
import { renderCompose, type RenderDeps } from "./render.js";

const STALE_BIND_MOUNT_RE = /docker-desktop-bind-mounts.*no such file/i;

async function clearStaleSecretCache(
  deps: RenderDeps,
  outPath: string,
  installId: string,
  onLogLine?: (stream: "stdout" | "stderr", line: string) => void
): Promise<void> {
  // Tear the project down INCLUDING its volumes. This is destructive
  // (any pre-existing Postgres data is wiped), but the alternative is
  // worse: regenerating the password forces a new Docker bind-mount
  // hash (so the stale-cache symptom clears), but the existing volume
  // still has `pg_authid` baked with the OLD password — connections
  // fail with `password authentication failed for user "vex"`. Pre-M7
  // (no wallet ceremony yet) we have no user data worth preserving.
  // Post-M7 we'll need a `setupCompleteFlag` gate before this branch.
  await runSpawn(
    "docker",
    [
      "compose",
      "-f",
      outPath,
      "-p",
      `vex-${installId}`,
      "down",
      "--remove-orphans",
      "--volumes",
    ],
    {
      timeoutMs: 30_000,
      onStdoutLine: (line) => onLogLine?.("stdout", `[recovery] ${line}`),
      onStderrLine: (line) => onLogLine?.("stderr", `[recovery] ${line}`),
    }
  );
  // Reset all per-install state so the next render regenerates a fresh
  // install_id, password, and compose YAML. The new install_id yields
  // a brand-new volume namespace, and the new password hash forces
  // Docker Desktop to recompute its bind-mount cache.
  const installIdPath = path.join(deps.userDataDir, ".install-id");
  const secretsDir = path.join(deps.userDataDir, "local-infra", "secrets");
  const composeDir = path.join(deps.userDataDir, "compose");
  for (const target of [installIdPath, secretsDir, composeDir]) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      onLogLine?.("stdout", `[recovery] Cleared ${target}`);
    } catch (err: unknown) {
      onLogLine?.(
        "stderr",
        `[recovery] Failed to clear ${target}: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    }
  }
}

const DEFAULT_PG_PORT = 55432;
const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 10 * 60_000;   // 10 min for first pull on slow networks
const UP_TIMEOUT_MS = 2 * 60_000;       // 2 min — image is local by now

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

interface HealthProbeArgs {
  readonly pgPort: number;
  readonly pgPasswordPath: string;
  readonly attempt: number;
  readonly signal?: AbortSignal;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

async function probeDbHealth(args: HealthProbeArgs): Promise<boolean> {
  args.onLogLine?.(
    "stdout",
    `Postgres health probe #${args.attempt}: connecting on 127.0.0.1:${args.pgPort}…`
  );
  const result = await pgConnectProbe({
    host: "127.0.0.1",
    port: args.pgPort,
    database: "vex",
    user: "vex",
    pgPasswordPath: args.pgPasswordPath,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
  if (result.ok) {
    args.onLogLine?.("stdout", `Postgres health probe #${args.attempt}: ready.`);
    return true;
  }
  args.onLogLine?.(
    "stderr",
    `Postgres health probe #${args.attempt}: ${result.message}`
  );
  return false;
}

interface WaitForHealthArgs {
  readonly pgPort: number;
  readonly pgPasswordPath: string;
  readonly signal?: AbortSignal;
  readonly onLogLine?: (stream: "stdout" | "stderr", line: string) => void;
}

async function waitForHealth(args: WaitForHealthArgs): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (args.signal?.aborted) return false;
    attempt += 1;
    if (
      await probeDbHealth({
        pgPort: args.pgPort,
        pgPasswordPath: args.pgPasswordPath,
        attempt,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(args.onLogLine !== undefined ? { onLogLine: args.onLogLine } : {}),
      })
    ) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

export async function composeUp(
  deps: RenderDeps,
  options: ComposeUpOptions = {}
): Promise<ComposeUpResult> {
  const { signal, onLogLine, pgPort = DEFAULT_PG_PORT } = options;

  // Daemon preflight + auto-start. The user can have closed Docker
  // Desktop between System Check and ComposeBootstrap, so we re-probe
  // and (if needed) kick `performStart()` via the daemon helper.
  const daemon = await ensureDockerDaemonReady({
    signal,
    onStatus: (status) => onLogLine?.("stdout", status),
  });
  if (daemon.kind !== "ready" && daemon.kind !== "auto_started") {
    // Render so the renderer can display where the file would have landed,
    // even though we never made it to compose.
    const rendered = await renderCompose(deps, { pgPort });
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `Docker daemon is not ready: ${daemon.message}`,
    };
  }

  const rendered = await renderCompose(deps, { pgPort });

  // Pre-flight: is the host port free?
  const portFree = await isPortFree("127.0.0.1", pgPort, signal);
  if (!portFree) {
    const ourStack = await isOurProjectActive(rendered.installId, signal);
    if (ourStack) {
      const healthy = await waitForHealth({
        pgPort,
        pgPasswordPath: rendered.pgPasswordComposePath,
        ...(signal !== undefined ? { signal } : {}),
        ...(onLogLine !== undefined ? { onLogLine } : {}),
      });
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

  // Pull the image first. Implicit pull inside `up -d` blocks the entire
  // command without progress; explicit `pull` lets us bound it (10 min)
  // and stream pull progress to the renderer log buffer.
  onLogLine?.("stdout", "Pulling pgvector image (first run can take 1–5 min)…");
  const pullResult = await runSpawn(
    "docker",
    ["compose", "-f", rendered.outPath, "pull", "db"],
    {
      signal,
      timeoutMs: PULL_TIMEOUT_MS,
      onStdoutLine: (line) => onLogLine?.("stdout", line),
      onStderrLine: (line) => onLogLine?.("stderr", line),
    }
  );
  if (pullResult.timedOut) {
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `Image pull timed out after ${PULL_TIMEOUT_MS / 60_000} min. Check your network or retry.`,
    };
  }
  if (pullResult.code !== 0) {
    return {
      kind: "failed",
      composeOutPath: rendered.outPath,
      installId: rendered.installId,
      message: `\`docker compose pull\` exited with ${pullResult.code ?? "unknown"}: ${pullResult.stderr.split("\n").slice(-3).join(" ")}`,
    };
  }

  onLogLine?.("stdout", "Starting Vex stack…");
  let upResult = await runSpawn(
    "docker",
    ["compose", "-f", rendered.outPath, "up", "-d"],
    {
      signal,
      timeoutMs: UP_TIMEOUT_MS,
      onStdoutLine: (line) => onLogLine?.("stdout", line),
      onStderrLine: (line) => onLogLine?.("stderr", line),
    }
  );

  // Detect Docker Desktop's stale bind-mount cache failure. After a
  // Docker Desktop restart the cache directory under
  // `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/<distro>/<hash>`
  // is wiped; the daemon still references the old hash, mount fails with
  // "no such file or directory". Recovery: tear the project down,
  // regenerate the password file (new content → new bind-mount hash),
  // re-render the compose, and retry up-d ONCE.
  let renderedAfterRecovery = rendered;
  if (
    upResult.code !== 0 &&
    !upResult.timedOut &&
    STALE_BIND_MOUNT_RE.test(upResult.stderr)
  ) {
    onLogLine?.(
      "stdout",
      "[recovery] Detected stale Docker Desktop bind-mount cache; refreshing secret + retrying…"
    );
    await clearStaleSecretCache(
      deps,
      rendered.outPath,
      rendered.installId,
      onLogLine
    );
    renderedAfterRecovery = await renderCompose(deps, { pgPort });
    upResult = await runSpawn(
      "docker",
      ["compose", "-f", renderedAfterRecovery.outPath, "up", "-d"],
      {
        signal,
        timeoutMs: UP_TIMEOUT_MS,
        onStdoutLine: (line) => onLogLine?.("stdout", line),
        onStderrLine: (line) => onLogLine?.("stderr", line),
      }
    );
  }

  if (upResult.timedOut) {
    return {
      kind: "failed",
      composeOutPath: renderedAfterRecovery.outPath,
      installId: renderedAfterRecovery.installId,
      message: `\`docker compose up -d\` timed out after ${UP_TIMEOUT_MS / 60_000} min.`,
    };
  }
  if (upResult.code !== 0) {
    return {
      kind: "failed",
      composeOutPath: renderedAfterRecovery.outPath,
      installId: renderedAfterRecovery.installId,
      message: `\`docker compose up -d\` exited with ${upResult.code ?? "unknown"}: ${upResult.stderr.split("\n").slice(-3).join(" ")}`,
    };
  }

  onLogLine?.("stdout", "Waiting for Postgres to accept connections…");
  const healthy = await waitForHealth({
    pgPort,
    pgPasswordPath: renderedAfterRecovery.pgPasswordComposePath,
    ...(signal !== undefined ? { signal } : {}),
    ...(onLogLine !== undefined ? { onLogLine } : {}),
  });
  return {
    kind: healthy ? "running" : "unhealthy",
    composeOutPath: renderedAfterRecovery.outPath,
    installId: renderedAfterRecovery.installId,
    message: healthy
      ? `Vex stack vex-${renderedAfterRecovery.installId} is running on :${pgPort}.`
      : `Stack started but Postgres did not accept a TCP connection within ${HEALTH_TIMEOUT_MS / 1000}s.`,
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
