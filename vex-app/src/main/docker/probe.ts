/**
 * Async Docker probe runner. Replaces `spawnSync`-based engine helpers
 * (which would freeze Electron's main process — codex turn 3 RED #2)
 * with `execFile` + `AbortController` + per-probe timeout. Pure parsers
 * are unit-testable on string fixtures so we never need Docker installed
 * to run the test suite.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createConnection } from "node:net";
import { statfs } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 8_000;
const PORT_PROBE_TIMEOUT_MS = 1_000;
const HTTP_PROBE_TIMEOUT_MS = 2_000;
const MAX_BUFFER = 1024 * 1024;

interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorMessage: string | null;
}

async function runCmd(
  cmd: string,
  args: ReadonlyArray<string>,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RunResult> {
  const ac = new AbortController();
  const linkedAbort = (): void => ac.abort();
  signal?.addEventListener("abort", linkedAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args], {
      signal: ac.signal,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr, errorMessage: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: unknown }).stdout ?? "")
        : "";
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : "";
    return { ok: false, stdout, stderr, errorMessage: message };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", linkedAbort);
  }
}

// ── Pure parsers (fixture-testable) ──────────────────────────────────

export function parseDockerVersion(stdout: string): string | null {
  // "Docker version 27.5.1, build 9f9e405"
  const match = stdout.match(/Docker version\s+([^\s,]+)/);
  return match?.[1] ?? null;
}

export function parseComposeVersion(stdout: string): string | null {
  // "Docker Compose version v2.32.4" or "Docker Compose version 2.32.4"
  const match = stdout.match(/Docker Compose version\s+(v?[\d][\w.+-]*)/);
  return match?.[1] ?? null;
}

/**
 * Minimum Docker Compose version required by vex-app's compose template.
 * The `configs:` block with inline `content:` was introduced in
 * Compose 2.23.1 (docker/compose#10942). Below this floor, `compose up`
 * fails with "unknown field: content" — the System Check screen
 * displays an actionable upgrade hint instead of letting the user hit
 * the cryptic failure.
 */
export const COMPOSE_VERSION_FLOOR = "2.23.1";

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Tolerant semver parser — accepts `v2.23.1`, `2.23.1-desktop.1`,
 * `2.39.2+meta`, `v2.40.0-rc.2`. Returns null for anything that does
 * not start with major.minor.patch numeric triplet. The pre-release /
 * build suffix is ignored on purpose — Compose ships `-desktop.N`
 * variants that are semver-compatible with the base version.
 */
export function parseSemver(version: string | null): ParsedSemver | null {
  if (version === null || version.length === 0) return null;
  const stripped = version.startsWith("v") ? version.slice(1) : version;
  const match = stripped.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const [, majorStr, minorStr, patchStr] = match;
  if (
    majorStr === undefined ||
    minorStr === undefined ||
    patchStr === undefined
  ) {
    return null;
  }
  const major = Number.parseInt(majorStr, 10);
  const minor = Number.parseInt(minorStr, 10);
  const patch = Number.parseInt(patchStr, 10);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }
  return { major, minor, patch };
}

/**
 * Returns true iff `actual >= minimum` after ignoring pre-release /
 * build suffixes. Used by `lifecycle.composeUp` to short-circuit with
 * a helpful error before attempting a `compose up` that would fail
 * with an obscure `unknown field: content` from the inline configs
 * block.
 */
export function semverGte(
  actual: string | null,
  minimum: string
): boolean {
  const a = parseSemver(actual);
  const b = parseSemver(minimum);
  if (a === null || b === null) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

export type ModelStatusKind = "active" | "inactive" | "unsupported";

export function parseModelStatus(
  stdout: string,
  errorMessage: string | null
): ModelStatusKind {
  if (errorMessage && /unknown command|no such command|is not a docker command/i.test(errorMessage)) {
    return "unsupported";
  }
  if (errorMessage && /unknown command|no such command/i.test(stdout)) {
    return "unsupported";
  }
  // Order matters: "Docker Model Runner is not running" contains the literal
  // word "running", so the negative pattern MUST be tested first.
  if (/not.*running|disabled|inactive|stopped/i.test(stdout)) return "inactive";
  if (/running|enabled|active/i.test(stdout)) return "active";
  if (errorMessage) return "inactive";
  return "inactive";
}

export function parseDaemonRunning(
  infoStdout: string,
  errorMessage: string | null
): boolean {
  if (errorMessage) {
    // Common stderrs when daemon is unreachable.
    return false;
  }
  // We invoke `docker info --format "{{json .}}"` (codex turn 5 RED #4 —
  // the previous text-format check would always say "stopped"). When the
  // daemon is reachable, the JSON object includes a non-empty
  // `ServerVersion` field. The client-only fast path prints `{}` plus a
  // separate stderr message — the function above already short-circuits
  // on errorMessage.
  const trimmed = infoStdout.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { ServerVersion?: unknown }).ServerVersion === "string" &&
      ((parsed as { ServerVersion: string }).ServerVersion).length > 0
    ) {
      return true;
    }
    return false;
  } catch {
    // Fallback: legacy text format ("Server Version: x.y.z") in case
    // someone wires probeDocker without --format=json.
    return /Server Version:/i.test(infoStdout);
  }
}

// ── TCP / HTTP probes (used for ports + Model Runner reachability) ───

export async function isPortFree(
  host: string,
  port: number,
  signal?: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const cleanup = (free: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(free);
    };
    const timer = setTimeout(() => cleanup(true), PORT_PROBE_TIMEOUT_MS);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cleanup(false);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cleanup(true);
    });
  });
}

export async function isModelRunnerEndpointReachable(
  baseUrl: string = "http://127.0.0.1:12434/engines/llama.cpp/v1",
  signal?: AbortSignal
): Promise<boolean> {
  const ac = new AbortController();
  const linked = (): void => ac.abort();
  signal?.addEventListener("abort", linked, { once: true });
  const timer = setTimeout(() => ac.abort(), HTTP_PROBE_TIMEOUT_MS);
  try {
    // Append `/models` to baseUrl rather than using `new URL("/v1/models", …)`
    // which would silently drop the engine path (codex turn 5 YELLOW #1).
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", linked);
  }
}

// ── Disk space ───────────────────────────────────────────────────────

export async function getAvailableDiskGB(targetPath: string): Promise<number> {
  try {
    const stats = await statfs(targetPath);
    const bytes = stats.bavail * stats.bsize;
    const gb = bytes / 1024 / 1024 / 1024;
    // Round to 2 decimals — anything below ~5GB is the operational threshold
    // surface as a warning row in System Check.
    return Math.max(0, Math.round(gb * 100) / 100);
  } catch {
    return 0;
  }
}

// ── Composite probe ──────────────────────────────────────────────────

import type { DockerStatus } from "@shared/schemas/docker.js";

export interface DockerProbeOpts {
  readonly signal?: AbortSignal;
  readonly pgPort: number;
  readonly modelRunnerBaseUrl?: string;
  readonly diskTarget: string;
}

export async function probeDocker(opts: DockerProbeOpts): Promise<DockerStatus> {
  const { signal, pgPort, modelRunnerBaseUrl, diskTarget } = opts;

  const [versionRes, composeRes, modelRes, infoRes, pgFree, mrTcp, diskGB] =
    await Promise.all([
      runCmd("docker", ["--version"], signal),
      runCmd("docker", ["compose", "version"], signal),
      runCmd("docker", ["model", "status"], signal),
      runCmd("docker", ["info", "--format", "{{json .}}"], signal),
      isPortFree("127.0.0.1", pgPort, signal),
      isModelRunnerEndpointReachable(modelRunnerBaseUrl, signal),
      getAvailableDiskGB(diskTarget),
    ]);

  const engineVersion = versionRes.ok ? parseDockerVersion(versionRes.stdout) : null;
  const composeVersion = composeRes.ok ? parseComposeVersion(composeRes.stdout) : null;
  const modelStatus = parseModelStatus(modelRes.stdout, modelRes.errorMessage);
  const daemonRunning = parseDaemonRunning(infoRes.stdout, infoRes.errorMessage);

  return {
    engine: {
      present: versionRes.ok,
      version: engineVersion,
      runtimeOK: versionRes.ok && daemonRunning,
    },
    compose: {
      present: composeRes.ok,
      version: composeVersion,
    },
    modelRunner: {
      present: modelStatus !== "unsupported",
      status: modelStatus,
      tcpReachable: mrTcp,
    },
    daemon: {
      running: daemonRunning,
      // Startable on macOS/Windows with Docker Desktop installed; on Linux
      // requires `pkexec systemctl start docker`. M4 will refine this with
      // explicit per-OS detection — for M2 we approximate.
      startable: versionRes.ok,
    },
    ports: {
      vexPgFree: pgFree,
    },
    disk: {
      availableGB: diskGB,
    },
  };
}
