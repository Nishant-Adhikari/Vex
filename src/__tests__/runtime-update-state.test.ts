import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(
  tmpdir(),
  `echo-runtime-update-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);
const testPackageRoot = join(testDir, "package-root");

vi.mock("../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../config/paths.js", () => ({
  CONFIG_DIR: testDir,
}));

vi.mock("../config/store.js", () => ({
  ensureConfigDir: () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  },
}));

vi.mock("../agent/constants.js", () => ({
  PACKAGE_ROOT: testPackageRoot,
}));

const {
  getDefaultRuntimeUpdateState,
  loadRuntimeUpdateState,
  readInstalledPackageVersion,
  RUNTIME_UPDATE_PULL_LOCK_FILE,
  RUNTIME_UPDATE_PULL_LOCK_STALE_MS,
  releaseRuntimeUpdatePullLock,
  saveRuntimeUpdateState,
  tryAcquireRuntimeUpdatePullLock,
} = await import("../update/runtime-update-state.js");

describe("runtime-update-state", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testPackageRoot, { recursive: true });
  });

  it("returns defaults when state file is missing", () => {
    expect(loadRuntimeUpdateState()).toEqual(getDefaultRuntimeUpdateState());
  });

  it("persists and reloads runtime update state", () => {
    const state = {
      ...getDefaultRuntimeUpdateState(),
      targetPackageVersion: "1.2.3",
      pullStatus: "ready" as const,
      preparedPackageVersion: "1.2.3",
      updatedAt: new Date().toISOString(),
    };

    saveRuntimeUpdateState(state);

    expect(loadRuntimeUpdateState()).toEqual(state);
  });

  it("reads the installed package version from package.json", () => {
    writeFileSync(join(testPackageRoot, "package.json"), JSON.stringify({ version: "9.9.9" }), "utf-8");

    expect(readInstalledPackageVersion()).toBe("9.9.9");
  });

  it("falls back to defaults when the state file is invalid", () => {
    writeFileSync(join(testDir, "runtime-update.json"), JSON.stringify({ version: 99 }), "utf-8");

    expect(loadRuntimeUpdateState()).toEqual(getDefaultRuntimeUpdateState());
  });

  it("acquires and releases the runtime pull lock", () => {
    expect(tryAcquireRuntimeUpdatePullLock()).toBe(true);
    expect(tryAcquireRuntimeUpdatePullLock()).toBe(false);

    releaseRuntimeUpdatePullLock();

    expect(tryAcquireRuntimeUpdatePullLock()).toBe(true);
  });

  it("recovers a stale runtime pull lock", () => {
    writeFileSync(
      RUNTIME_UPDATE_PULL_LOCK_FILE,
      String(Date.now() - RUNTIME_UPDATE_PULL_LOCK_STALE_MS - 1_000),
      "utf-8",
    );

    expect(tryAcquireRuntimeUpdatePullLock()).toBe(true);
  });
});
