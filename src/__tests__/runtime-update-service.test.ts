import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeUpdateState } from "../update/runtime-update-state.js";

function makeState(overrides: Partial<RuntimeUpdateState> = {}): RuntimeUpdateState {
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
    ...overrides,
  };
}

let currentState = makeState();
let installedVersion = "1.0.0";
let managedByPackage = true;
let desiredAgentImage = "ghcr.io/echoclaw-labs/echoclaw/echo-agent:1.0.0";
let desiredAgentTag = "1.0.0";
let pullLockAvailable = true;

const savedStates: RuntimeUpdateState[] = [];
const fetchMock = vi.fn();
const mockRunAgentCompose = vi.fn();
const mockWaitForAgentHealth = vi.fn();
const mockLoadProviderDotenv = vi.fn();
const mockEnsureAgentPasswordReadyForContainer = vi.fn();
const mockReleaseRuntimeUpdatePullLock = vi.fn();
const mockGetAgentComposeFailureInfo = vi.fn((err: unknown, options: { defaultHint?: string } = {}) => ({
  detail: err instanceof Error ? err.message : String(err),
  message: err instanceof Error ? err.message : String(err),
  hint: options.defaultHint,
  isReleaseIssue: false,
}));
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};

vi.mock("../agent/constants.js", () => ({
  AGENT_DEFAULT_PORT: 7777,
}));

vi.mock("../agent/compose.js", () => ({
  getAgentComposeFailureInfo: (...args: any[]) => mockGetAgentComposeFailureInfo(...args),
  getAgentImage: () => desiredAgentImage,
  getAgentImageTag: () => desiredAgentTag,
  runAgentCompose: (...args: any[]) => mockRunAgentCompose(...args),
  waitForAgentHealth: (...args: any[]) => mockWaitForAgentHealth(...args),
}));

vi.mock("../providers/env-resolution.js", () => ({
  loadProviderDotenv: (...args: any[]) => mockLoadProviderDotenv(...args),
}));

vi.mock("../password/compat.js", () => ({
  ensureAgentPasswordReadyForContainer: (...args: any[]) => mockEnsureAgentPasswordReadyForContainer(...args),
}));

vi.mock("../utils/logger.js", () => ({
  default: mockLogger,
}));

vi.mock("../update/runtime-update-state.js", () => ({
  isAgentImageManagedByPackage: () => managedByPackage,
  loadRuntimeUpdateState: () => structuredClone(currentState),
  readInstalledPackageVersion: () => installedVersion,
  releaseRuntimeUpdatePullLock: (...args: any[]) => mockReleaseRuntimeUpdatePullLock(...args),
  saveRuntimeUpdateState: (state: RuntimeUpdateState) => {
    currentState = structuredClone(state);
    savedStates.push(structuredClone(state));
  },
  tryAcquireRuntimeUpdatePullLock: () => pullLockAvailable,
}));

const {
  markPackageAutoUpdated,
  getRuntimeUpdateStatus,
  startRuntimeUpdatePullInBackground,
  retryRuntimeUpdatePull,
  applyRuntimeUpdate,
} = await import("../update/runtime-update-service.js");

describe.sequential("runtime-update-service", () => {
  beforeEach(() => {
    currentState = makeState();
    installedVersion = "1.0.0";
    managedByPackage = true;
    desiredAgentImage = "ghcr.io/echoclaw-labs/echoclaw/echo-agent:1.0.0";
    desiredAgentTag = "1.0.0";
    pullLockAvailable = true;
    savedStates.length = 0;
    fetchMock.mockReset();
    mockRunAgentCompose.mockReset();
    mockWaitForAgentHealth.mockReset().mockResolvedValue(true);
    mockLoadProviderDotenv.mockReset();
    mockEnsureAgentPasswordReadyForContainer.mockReset();
    mockReleaseRuntimeUpdatePullLock.mockReset();
    mockGetAgentComposeFailureInfo.mockClear();
    for (const fn of Object.values(mockLogger)) {
      fn.mockReset();
    }
    globalThis.fetch = fetchMock as typeof fetch;
  });

  it("preserves ready state only when the prepared runtime already matches the updated package", () => {
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "ready",
      preparedPackageVersion: "2.0.0",
    });

    const next = markPackageAutoUpdated("2.0.0");

    expect(next.targetPackageVersion).toBe("2.0.0");
    expect(next.pullStatus).toBe("ready");

    currentState = makeState({
      targetPackageVersion: "1.9.0",
      pullStatus: "ready",
      preparedPackageVersion: "1.9.0",
    });

    const reset = markPackageAutoUpdated("2.0.0");

    expect(reset.targetPackageVersion).toBe("2.0.0");
    expect(reset.pullStatus).toBe("idle");
    expect(reset.pullStartedAt).toBeNull();
  });

  it("clears managed agent pending state when the runtime image is explicitly overridden", () => {
    managedByPackage = false;
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "failed",
      preparedPackageVersion: "1.9.0",
      lastError: "pull failed",
    });

    const next = markPackageAutoUpdated("2.0.0");

    expect(next.targetPackageVersion).toBeNull();
    expect(next.pullStatus).toBe("idle");
    expect(next.lastError).toBeNull();
  });

  it("clears pending state when the running agent already matches the target version", async () => {
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "ready",
      preparedPackageVersion: "2.0.0",
    });
    installedVersion = "2.0.0";
    desiredAgentImage = "ghcr.io/echoclaw-labs/echoclaw/echo-agent:2.0.0";
    desiredAgentTag = "2.0.0";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2.0.0" }),
    });

    const status = await getRuntimeUpdateStatus();

    expect(status.targetPackageVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
    expect(currentState.targetPackageVersion).toBeNull();
    expect(currentState.preparedPackageVersion).toBe("2.0.0");
  });

  it.each([
    {
      label: "no target version is pending",
      setup: () => {
        currentState = makeState();
      },
    },
    {
      label: "installed package does not match the pending target",
      setup: () => {
        installedVersion = "1.0.0";
        currentState = makeState({ targetPackageVersion: "2.0.0" });
      },
    },
    {
      label: "the runtime pull lock is unavailable",
      setup: () => {
        currentState = makeState({ targetPackageVersion: "1.0.0" });
        pullLockAvailable = false;
      },
    },
    {
      label: "the runtime update is already prepared",
      setup: () => {
        currentState = makeState({
          targetPackageVersion: "1.0.0",
          pullStatus: "ready",
          preparedPackageVersion: "1.0.0",
        });
      },
    },
  ])("does not start a background pull when $label", ({ setup }) => {
    setup();

    expect(startRuntimeUpdatePullInBackground("startup")).toBe(false);
    expect(mockRunAgentCompose).not.toHaveBeenCalled();
  });

  it("pulls and marks the runtime ready when the image download succeeds", () => {
    installedVersion = "2.0.0";
    desiredAgentImage = "ghcr.io/echoclaw-labs/echoclaw/echo-agent:2.0.0";
    desiredAgentTag = "2.0.0";
    currentState = makeState({
      targetPackageVersion: "2.0.0",
    });

    expect(startRuntimeUpdatePullInBackground("startup")).toBe(true);

    expect(mockRunAgentCompose).toHaveBeenCalledWith(["pull", "agent"], {
      stdio: "pipe",
      timeoutMs: 300_000,
    });
    expect(currentState.pullStatus).toBe("ready");
    expect(currentState.preparedPackageVersion).toBe("2.0.0");
    expect(currentState.lastError).toBeNull();
    expect(mockReleaseRuntimeUpdatePullLock).toHaveBeenCalledTimes(1);
  });

  it("records a failure when the image download fails", () => {
    installedVersion = "2.0.0";
    currentState = makeState({
      targetPackageVersion: "2.0.0",
    });
    mockRunAgentCompose.mockImplementation(() => {
      throw new Error("docker compose pull failed");
    });

    expect(startRuntimeUpdatePullInBackground("startup")).toBe(true);

    expect(currentState.pullStatus).toBe("failed");
    expect(currentState.lastError).toContain("docker compose pull failed");
    expect(mockReleaseRuntimeUpdatePullLock).toHaveBeenCalledTimes(1);
  });

  it("retries a failed pull by resetting state and preparing the new image again", async () => {
    installedVersion = "2.0.0";
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "failed",
      lastError: "previous failure",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.0" }),
    });

    const status = await retryRuntimeUpdatePull();

    expect(currentState.pullStatus).toBe("ready");
    expect(currentState.lastError).toBeNull();
    expect(status.readyToApply).toBe(true);
    expect(mockRunAgentCompose).toHaveBeenCalledTimes(1);
  });

  it("returns a passive status when the agent image is unmanaged or no update is pending", async () => {
    managedByPackage = false;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.0" }),
    });

    const unmanaged = await applyRuntimeUpdate();

    expect(unmanaged.applied).toBe(false);
    expect(unmanaged.status.agentManagedByPackage).toBe(false);

    managedByPackage = true;
    currentState = makeState();

    const noTarget = await applyRuntimeUpdate();

    expect(noTarget.applied).toBe(false);
    expect(noTarget.healthy).toBe(true);
  });

  it("does not recreate the agent when the image is not ready yet", async () => {
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "pulling",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.0.0" }),
    });

    const result = await applyRuntimeUpdate();

    expect(result.applied).toBe(false);
    expect(result.healthy).toBe(false);
    expect(mockRunAgentCompose).not.toHaveBeenCalled();
  });

  it("treats an already-updated running agent as an idempotent apply", async () => {
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "ready",
      preparedPackageVersion: "2.0.0",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "2.0.0" }),
    });

    const result = await applyRuntimeUpdate();

    expect(result.applied).toBe(false);
    expect(result.healthy).toBe(true);
    expect(mockRunAgentCompose).not.toHaveBeenCalled();
    expect(currentState.targetPackageVersion).toBeNull();
  });

  it("clears the pending update after a successful recreate and health check", async () => {
    installedVersion = "2.0.0";
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "ready",
      preparedPackageVersion: "2.0.0",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      });
    mockWaitForAgentHealth.mockResolvedValue(true);

    const result = await applyRuntimeUpdate();

    expect(mockLoadProviderDotenv).toHaveBeenCalledTimes(1);
    expect(mockEnsureAgentPasswordReadyForContainer).toHaveBeenCalledTimes(1);
    expect(mockRunAgentCompose).toHaveBeenCalledWith(["up", "-d", "--force-recreate", "agent"], {
      stdio: "pipe",
      timeoutMs: 300_000,
    });
    expect(result.applied).toBe(true);
    expect(result.healthy).toBe(true);
    expect(currentState.targetPackageVersion).toBeNull();
    expect(currentState.applyInProgress).toBe(false);
  });

  it("keeps the pending update and records an error when the recreated agent stays unhealthy", async () => {
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "ready",
      preparedPackageVersion: "2.0.0",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      });
    mockWaitForAgentHealth.mockResolvedValue(false);

    const result = await applyRuntimeUpdate();

    expect(result.applied).toBe(true);
    expect(result.healthy).toBe(false);
    expect(currentState.targetPackageVersion).toBe("2.0.0");
    expect(currentState.lastError).toContain("not healthy yet");
  });

  it("surfaces compose failures during apply and leaves the update pending", async () => {
    currentState = makeState({
      targetPackageVersion: "2.0.0",
      pullStatus: "ready",
      preparedPackageVersion: "2.0.0",
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      });
    mockRunAgentCompose.mockImplementation(() => {
      throw new Error("compose up failed");
    });

    const result = await applyRuntimeUpdate();

    expect(result.applied).toBe(false);
    expect(result.healthy).toBe(false);
    expect(currentState.targetPackageVersion).toBe("2.0.0");
    expect(currentState.applyInProgress).toBe(false);
    expect(currentState.lastError).toContain("compose up failed");
  });
});
