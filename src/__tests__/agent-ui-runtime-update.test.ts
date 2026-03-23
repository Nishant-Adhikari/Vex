import { describe, expect, it } from "vitest";
import { buildRuntimeUpdateBannerModel } from "../agent/ui/src/runtime-update.js";
import type { AgentStatus } from "../agent/ui/src/types.js";

const baseStatus = {
  currentPackageVersion: "1.1.0",
  targetPackageVersion: "1.1.0",
  runningAgentVersion: "1.0.0",
  desiredAgentImage: "ghcr.io/echoclaw-labs/echoclaw/echo-agent:1.1.0",
  desiredAgentTag: "1.1.0",
  agentManagedByPackage: true,
  pullStatus: "ready" as const,
  preparedPackageVersion: "1.1.0",
  applyInProgress: false,
  lastError: null,
  updateAvailable: true,
  readyToApply: true,
};

describe("buildRuntimeUpdateBannerModel", () => {
  it("returns an apply banner when a downloaded update is ready", () => {
    const banner = buildRuntimeUpdateBannerModel(baseStatus, { version: "1.0.0" } as AgentStatus);

    expect(banner).toMatchObject({
      tone: "info",
      action: "apply",
      actionLabel: "Restart to update",
    });
  });

  it("returns a retry banner when the pull failed", () => {
    const banner = buildRuntimeUpdateBannerModel({
      ...baseStatus,
      pullStatus: "failed",
      lastError: "docker compose pull failed",
    }, { version: "1.0.0" } as AgentStatus);

    expect(banner).toMatchObject({
      tone: "error",
      action: "retry",
      actionLabel: "Retry download",
    });
  });

  it("returns null while the image is still pulling", () => {
    const banner = buildRuntimeUpdateBannerModel({
      ...baseStatus,
      pullStatus: "pulling",
    }, { version: "1.0.0" } as AgentStatus);

    expect(banner).toBeNull();
  });

  it("returns null when the agent already matches the target version", () => {
    const banner = buildRuntimeUpdateBannerModel(baseStatus, { version: "1.1.0" } as AgentStatus);

    expect(banner).toBeNull();
  });

  it("returns an applying banner while the restart is in progress", () => {
    const banner = buildRuntimeUpdateBannerModel({
      ...baseStatus,
      applyInProgress: true,
    }, { version: "1.0.0" } as AgentStatus);

    expect(banner).toMatchObject({
      tone: "info",
      title: "Applying update",
      action: null,
      disabled: true,
    });
  });

  it("returns null for unmanaged agent images", () => {
    const banner = buildRuntimeUpdateBannerModel({
      ...baseStatus,
      agentManagedByPackage: false,
    }, { version: "1.0.0" } as AgentStatus);

    expect(banner).toBeNull();
  });

  it("returns null when there is no target package version", () => {
    const banner = buildRuntimeUpdateBannerModel({
      ...baseStatus,
      targetPackageVersion: null,
      readyToApply: false,
    }, { version: "1.0.0" } as AgentStatus);

    expect(banner).toBeNull();
  });

  it("uses the current label when agent status is unavailable", () => {
    const banner = buildRuntimeUpdateBannerModel(baseStatus, null);

    expect(banner?.message).toContain("Agent vcurrent is still running");
  });
});
