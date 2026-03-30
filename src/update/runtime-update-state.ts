import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
// TODO(echo-agent): rewire to echo-agent/ — see agent-shim.ts for migration points
import { PACKAGE_ROOT } from "../agent-shim.js";
import { ensureConfigDir } from "../config/store.js";
import { CONFIG_DIR } from "../config/paths.js";
import logger from "../utils/logger.js";

export const RUNTIME_UPDATE_STATE_FILE = join(CONFIG_DIR, "runtime-update.json");
export const RUNTIME_UPDATE_PULL_LOCK_FILE = join(CONFIG_DIR, "runtime-update.pull.lock");
export const RUNTIME_UPDATE_PULL_LOCK_STALE_MS = 10 * 60 * 1000;

export type RuntimeUpdatePullStatus = "idle" | "pulling" | "ready" | "failed";

export interface RuntimeUpdateState {
  version: 1;
  targetPackageVersion: string | null;
  pullStatus: RuntimeUpdatePullStatus;
  preparedPackageVersion: string | null;
  lastError: string | null;
  pullStartedAt: string | null;
  pullFinishedAt: string | null;
  applyInProgress: boolean;
  applyStartedAt: string | null;
  updatedAt: string;
}

export function getDefaultRuntimeUpdateState(): RuntimeUpdateState {
  return {
    version: 1,
    targetPackageVersion: null,
    pullStatus: "idle",
    preparedPackageVersion: null,
    lastError: null,
    pullStartedAt: null,
    pullFinishedAt: null,
    applyInProgress: false,
    applyStartedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function coerceRuntimeUpdateState(raw: unknown): RuntimeUpdateState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 1) {
    return null;
  }

  const pullStatus = candidate.pullStatus;
  if (pullStatus !== "idle" && pullStatus !== "pulling" && pullStatus !== "ready" && pullStatus !== "failed") {
    return null;
  }

  const targetPackageVersion =
    typeof candidate.targetPackageVersion === "string" ? candidate.targetPackageVersion : null;
  const preparedPackageVersion =
    typeof candidate.preparedPackageVersion === "string" ? candidate.preparedPackageVersion : null;
  const lastError = typeof candidate.lastError === "string" ? candidate.lastError : null;
  const pullStartedAt = typeof candidate.pullStartedAt === "string" ? candidate.pullStartedAt : null;
  const pullFinishedAt = typeof candidate.pullFinishedAt === "string" ? candidate.pullFinishedAt : null;
  const applyInProgress = candidate.applyInProgress === true;
  const applyStartedAt = typeof candidate.applyStartedAt === "string" ? candidate.applyStartedAt : null;
  const updatedAt =
    typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString();

  return {
    version: 1,
    targetPackageVersion,
    pullStatus,
    preparedPackageVersion,
    lastError,
    pullStartedAt,
    pullFinishedAt,
    applyInProgress,
    applyStartedAt,
    updatedAt,
  };
}

export function loadRuntimeUpdateState(): RuntimeUpdateState {
  ensureConfigDir();
  if (!existsSync(RUNTIME_UPDATE_STATE_FILE)) {
    return getDefaultRuntimeUpdateState();
  }

  try {
    const raw = JSON.parse(readFileSync(RUNTIME_UPDATE_STATE_FILE, "utf-8")) as unknown;
    const parsed = coerceRuntimeUpdateState(raw);
    if (parsed) {
      return parsed;
    }
    logger.warn("Invalid runtime update state detected; resetting to defaults.");
  } catch (err) {
    logger.warn(`Failed to read runtime update state: ${err instanceof Error ? err.message : String(err)}`);
  }

  return getDefaultRuntimeUpdateState();
}

export function saveRuntimeUpdateState(state: RuntimeUpdateState): void {
  ensureConfigDir();
  const dir = dirname(RUNTIME_UPDATE_STATE_FILE);
  const tmpFile = join(dir, `.runtime-update.tmp.${Date.now()}.json`);

  try {
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmpFile, RUNTIME_UPDATE_STATE_FILE);
  } catch (err) {
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore temp cleanup errors.
    }
    throw err;
  }
}

export function updateRuntimeUpdateState(
  updater: (current: RuntimeUpdateState) => RuntimeUpdateState,
): RuntimeUpdateState {
  const nextState = updater(loadRuntimeUpdateState());
  saveRuntimeUpdateState(nextState);
  return nextState;
}

export function readInstalledPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function isAgentImageManagedByPackage(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicitImage = env.ECHO_AGENT_IMAGE?.trim();
  const explicitTag = env.ECHO_AGENT_IMAGE_TAG?.trim();
  return !explicitImage && !explicitTag;
}

export function tryAcquireRuntimeUpdatePullLock(): boolean {
  ensureConfigDir();

  try {
    const fd = openSync(RUNTIME_UPDATE_PULL_LOCK_FILE, "wx");
    try {
      writeFileSync(fd, String(Date.now()), "utf-8");
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    try {
      const raw = readFileSync(RUNTIME_UPDATE_PULL_LOCK_FILE, "utf-8");
      const ts = Number(raw.trim());
      if (Number.isFinite(ts) && Date.now() - ts > RUNTIME_UPDATE_PULL_LOCK_STALE_MS) {
        unlinkSync(RUNTIME_UPDATE_PULL_LOCK_FILE);
        const fd = openSync(RUNTIME_UPDATE_PULL_LOCK_FILE, "wx");
        try {
          writeFileSync(fd, String(Date.now()), "utf-8");
        } finally {
          closeSync(fd);
        }
        return true;
      }
    } catch {
      // Ignore stale-lock inspection errors.
    }
    return false;
  }
}

export function releaseRuntimeUpdatePullLock(): void {
  try {
    if (existsSync(RUNTIME_UPDATE_PULL_LOCK_FILE)) {
      unlinkSync(RUNTIME_UPDATE_PULL_LOCK_FILE);
    }
  } catch {
    // Ignore best-effort cleanup errors.
  }
}
