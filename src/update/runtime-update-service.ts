// TODO(echo-agent): rewire to echo-agent/ — see agent-shim.ts for migration points
import { AGENT_DEFAULT_PORT, getAgentComposeFailureInfo, getAgentImage, getAgentImageTag, runAgentCompose, waitForAgentHealth } from "../agent-shim.js";
import { loadProviderDotenv } from "../providers/env-resolution.js";
import { ensureAgentPasswordReadyForContainer } from "../password/compat.js";
import logger from "../utils/logger.js";
import {
  isAgentImageManagedByPackage,
  loadRuntimeUpdateState,
  readInstalledPackageVersion,
  releaseRuntimeUpdatePullLock,
  saveRuntimeUpdateState,
  tryAcquireRuntimeUpdatePullLock,
  type RuntimeUpdatePullStatus,
  type RuntimeUpdateState,
} from "./runtime-update-state.js";

export interface RuntimeUpdateStatus {
  currentPackageVersion: string;
  targetPackageVersion: string | null;
  runningAgentVersion: string | null;
  desiredAgentImage: string | null;
  desiredAgentTag: string | null;
  agentManagedByPackage: boolean;
  pullStatus: RuntimeUpdatePullStatus;
  preparedPackageVersion: string | null;
  applyInProgress: boolean;
  lastError: string | null;
  updateAvailable: boolean;
  readyToApply: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function withUpdatedAt(state: RuntimeUpdateState): RuntimeUpdateState {
  return {
    ...state,
    updatedAt: nowIso(),
  };
}

function clearPendingRuntimeUpdate(state: RuntimeUpdateState, appliedVersion: string | null): RuntimeUpdateState {
  return withUpdatedAt({
    ...state,
    targetPackageVersion: null,
    pullStatus: "idle",
    preparedPackageVersion: appliedVersion ?? state.preparedPackageVersion,
    lastError: null,
    pullFinishedAt: state.pullFinishedAt ?? nowIso(),
    applyInProgress: false,
    applyStartedAt: null,
  });
}

function getPullFailureMessage(err: unknown): string {
  const failure = getAgentComposeFailureInfo(err, { defaultHint: "Make sure Docker is running and retry." });
  return failure.hint ? `${failure.message} ${failure.hint}` : failure.message;
}

async function readRunningAgentVersion(): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${AGENT_DEFAULT_PORT}/api/agent/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const body = await res.json() as { version?: string };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

function getDesiredAgentImageForStatus(): { desiredAgentImage: string | null; desiredAgentTag: string | null } {
  if (isAgentImageManagedByPackage()) {
    return {
      desiredAgentImage: getAgentImage(),
      desiredAgentTag: getAgentImageTag(),
    };
  }

  return {
    desiredAgentImage: process.env.ECHO_AGENT_IMAGE?.trim() || null,
    desiredAgentTag: process.env.ECHO_AGENT_IMAGE_TAG?.trim() || null,
  };
}

export function markPackageAutoUpdated(targetPackageVersion: string): RuntimeUpdateState {
  const currentState = loadRuntimeUpdateState();
  if (!isAgentImageManagedByPackage()) {
    const clearedState = clearPendingRuntimeUpdate(currentState, currentState.preparedPackageVersion);
    saveRuntimeUpdateState(clearedState);
    return clearedState;
  }

  const readyForTarget =
    currentState.targetPackageVersion === targetPackageVersion
    && currentState.preparedPackageVersion === targetPackageVersion
    && currentState.pullStatus === "ready";

  const nextState = withUpdatedAt({
    ...currentState,
    targetPackageVersion,
    pullStatus: readyForTarget ? "ready" : "idle",
    lastError: null,
    pullStartedAt: readyForTarget ? currentState.pullStartedAt : null,
    pullFinishedAt: readyForTarget ? currentState.pullFinishedAt : null,
    applyInProgress: false,
    applyStartedAt: null,
  });

  saveRuntimeUpdateState(nextState);
  return nextState;
}

export async function getRuntimeUpdateStatus(): Promise<RuntimeUpdateStatus> {
  const currentPackageVersion = readInstalledPackageVersion();
  let state = loadRuntimeUpdateState();
  const runningAgentVersion = await readRunningAgentVersion();

  if (
    state.targetPackageVersion != null
    && runningAgentVersion != null
    && runningAgentVersion === state.targetPackageVersion
    && !state.applyInProgress
  ) {
    state = clearPendingRuntimeUpdate(state, runningAgentVersion);
    saveRuntimeUpdateState(state);
  }

  const { desiredAgentImage, desiredAgentTag } = getDesiredAgentImageForStatus();
  const agentManagedByPackage = isAgentImageManagedByPackage();
  const updateAvailable =
    agentManagedByPackage
    && state.targetPackageVersion != null
    && runningAgentVersion !== state.targetPackageVersion;
  const readyToApply =
    updateAvailable
    && state.pullStatus === "ready"
    && !state.applyInProgress;

  return {
    currentPackageVersion,
    targetPackageVersion: state.targetPackageVersion,
    runningAgentVersion,
    desiredAgentImage,
    desiredAgentTag,
    agentManagedByPackage,
    pullStatus: state.pullStatus,
    preparedPackageVersion: state.preparedPackageVersion,
    applyInProgress: state.applyInProgress,
    lastError: state.lastError,
    updateAvailable,
    readyToApply,
  };
}

export function startRuntimeUpdatePullInBackground(reason: "startup" | "retry" = "startup"): boolean {
  if (!isAgentImageManagedByPackage()) {
    return false;
  }

  const currentPackageVersion = readInstalledPackageVersion();
  const state = loadRuntimeUpdateState();
  if (state.targetPackageVersion == null) {
    return false;
  }
  if (state.targetPackageVersion !== currentPackageVersion) {
    logger.info(`[runtime-update] skipping ${reason} pull; target ${state.targetPackageVersion} does not match installed ${currentPackageVersion}`);
    return false;
  }
  if (state.applyInProgress) {
    return false;
  }
  if (state.pullStatus === "ready" && state.preparedPackageVersion === state.targetPackageVersion) {
    return false;
  }
  if (!tryAcquireRuntimeUpdatePullLock()) {
    return false;
  }

  const targetVersion = state.targetPackageVersion;
  saveRuntimeUpdateState(withUpdatedAt({
    ...state,
    pullStatus: "pulling",
    lastError: null,
    pullStartedAt: nowIso(),
    pullFinishedAt: null,
  }));

  void (async () => {
    try {
      logger.info(`[runtime-update] pulling agent image for package ${targetVersion} (${reason})`);
      runAgentCompose(["pull", "agent"], {
        stdio: "pipe",
        timeoutMs: 300_000,
      });

      const latestState = loadRuntimeUpdateState();
      saveRuntimeUpdateState(withUpdatedAt({
        ...latestState,
        pullStatus: latestState.targetPackageVersion === targetVersion ? "ready" : "idle",
        preparedPackageVersion: targetVersion,
        lastError: null,
        pullFinishedAt: nowIso(),
      }));
    } catch (err) {
      const latestState = loadRuntimeUpdateState();
      const message = getPullFailureMessage(err);
      logger.warn(`[runtime-update] agent image pull failed: ${message}`);
      saveRuntimeUpdateState(withUpdatedAt({
        ...latestState,
        pullStatus: latestState.targetPackageVersion === targetVersion ? "failed" : latestState.pullStatus,
        lastError: latestState.targetPackageVersion === targetVersion ? message : latestState.lastError,
        pullFinishedAt: nowIso(),
      }));
    } finally {
      releaseRuntimeUpdatePullLock();
    }
  })();

  return true;
}

export async function retryRuntimeUpdatePull(): Promise<RuntimeUpdateStatus> {
  const currentState = loadRuntimeUpdateState();
  if (currentState.targetPackageVersion == null) {
    return getRuntimeUpdateStatus();
  }

  saveRuntimeUpdateState(withUpdatedAt({
    ...currentState,
    pullStatus: "idle",
    lastError: null,
    pullStartedAt: null,
    pullFinishedAt: null,
  }));
  startRuntimeUpdatePullInBackground("retry");
  return getRuntimeUpdateStatus();
}

export async function applyRuntimeUpdate(): Promise<{ applied: boolean; healthy: boolean; status: RuntimeUpdateStatus }> {
  const managedByPackage = isAgentImageManagedByPackage();
  let state = loadRuntimeUpdateState();
  const runningAgentVersion = await readRunningAgentVersion();

  if (!managedByPackage || state.targetPackageVersion == null) {
    return {
      applied: false,
      healthy: runningAgentVersion != null,
      status: await getRuntimeUpdateStatus(),
    };
  }

  if (runningAgentVersion === state.targetPackageVersion) {
    state = clearPendingRuntimeUpdate(state, runningAgentVersion);
    saveRuntimeUpdateState(state);
    return {
      applied: false,
      healthy: true,
      status: await getRuntimeUpdateStatus(),
    };
  }

  if (state.pullStatus !== "ready" || state.preparedPackageVersion !== state.targetPackageVersion) {
    return {
      applied: false,
      healthy: false,
      status: await getRuntimeUpdateStatus(),
    };
  }

  state = withUpdatedAt({
    ...state,
    applyInProgress: true,
    applyStartedAt: nowIso(),
    lastError: null,
  });
  saveRuntimeUpdateState(state);

  try {
    loadProviderDotenv();
    ensureAgentPasswordReadyForContainer();
    runAgentCompose(["up", "-d", "--force-recreate", "agent"], {
      stdio: "pipe",
      timeoutMs: 300_000,
    });

    const healthy = await waitForAgentHealth(AGENT_DEFAULT_PORT, {
      attempts: 20,
      intervalMs: 2_000,
      timeoutMs: 2_000,
    });

    if (healthy) {
      const latestState = loadRuntimeUpdateState();
      saveRuntimeUpdateState(clearPendingRuntimeUpdate(latestState, latestState.targetPackageVersion));
    } else {
      const latestState = loadRuntimeUpdateState();
      saveRuntimeUpdateState(withUpdatedAt({
        ...latestState,
        applyInProgress: false,
        applyStartedAt: null,
        lastError: "Agent restarted, but the new runtime is not healthy yet. Check Docker logs and retry.",
      }));
    }

    return {
      applied: true,
      healthy,
      status: await getRuntimeUpdateStatus(),
    };
  } catch (err) {
    const latestState = loadRuntimeUpdateState();
    const message = getPullFailureMessage(err);
    saveRuntimeUpdateState(withUpdatedAt({
      ...latestState,
      applyInProgress: false,
      applyStartedAt: null,
      lastError: message,
    }));
    return {
      applied: false,
      healthy: false,
      status: await getRuntimeUpdateStatus(),
    };
  }
}
