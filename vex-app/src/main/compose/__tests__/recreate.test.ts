/**
 * Tests for `recreateProjectNonDestructively` (issue #26) — the
 * non-destructive `compose down --remove-orphans` (no `--volumes`) + ONE
 * `up -d` retry helper used to recover from Docker Desktop's stale
 * bind-mount cache without the destructive wipe in stale-secret-recovery.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpawnRunnerResult } from "../../docker/spawn-runner.js";

const runSpawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../docker/spawn-runner.js", () => ({ runSpawn: runSpawnMock }));

import { recreateProjectNonDestructively } from "../recreate.js";

const INSTALL_ID = "11111111-2222-4333-8444-555555555555";
const COMPOSE_DIR = "/tmp/vex-compose/11111111-2222-4333-8444-555555555555";

function spawnResult(partial: Partial<SpawnRunnerResult> = {}): SpawnRunnerResult {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    aborted: false,
    timedOut: false,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runSpawnMock.mockResolvedValue(spawnResult());
});

describe("recreateProjectNonDestructively", () => {
  it("runs a project-scoped `down --remove-orphans` then exactly ONE `up -d` retry", async () => {
    const result = await recreateProjectNonDestructively({
      composeDir: COMPOSE_DIR,
      installId: INSTALL_ID,
    });

    expect(runSpawnMock).toHaveBeenCalledTimes(2);

    const [downCmd, downArgs, downOpts] = runSpawnMock.mock.calls[0]!;
    expect(downCmd).toBe("docker");
    expect(downArgs).toEqual([
      "compose",
      "-p",
      `vex-${INSTALL_ID}`,
      "down",
      "--remove-orphans",
    ]);
    expect((downOpts as { cwd?: string }).cwd).toBe(COMPOSE_DIR);

    const [upCmd, upArgs, upOpts] = runSpawnMock.mock.calls[1]!;
    expect(upCmd).toBe("docker");
    expect(upArgs).toEqual(["compose", "up", "-d"]);
    // Same composeDir as the down call — no re-render, secret untouched.
    expect((upOpts as { cwd?: string }).cwd).toBe(COMPOSE_DIR);

    expect(result.downResult.code).toBe(0);
    expect(result.upResult.code).toBe(0);
  });

  it("never passes `--volumes` on the down call", async () => {
    await recreateProjectNonDestructively({
      composeDir: COMPOSE_DIR,
      installId: INSTALL_ID,
    });
    const downArgs = runSpawnMock.mock.calls[0]![1] as string[];
    expect(downArgs).not.toContain("--volumes");
  });

  it("scopes the down call to this install's project only (`-p vex-<installId>`)", async () => {
    await recreateProjectNonDestructively({
      composeDir: COMPOSE_DIR,
      installId: INSTALL_ID,
    });
    const downArgs = runSpawnMock.mock.calls[0]![1] as string[];
    expect(downArgs).toContain("-p");
    expect(downArgs[downArgs.indexOf("-p") + 1]).toBe(`vex-${INSTALL_ID}`);
  });

  it("does not run either command when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await recreateProjectNonDestructively({
      composeDir: COMPOSE_DIR,
      installId: INSTALL_ID,
      signal: controller.signal,
    });

    expect(runSpawnMock).not.toHaveBeenCalled();
    expect(result.downResult.aborted).toBe(true);
    expect(result.upResult.aborted).toBe(true);
  });

  it("skips the `up -d` retry when cancellation lands between down and up (down already ran safely)", async () => {
    const controller = new AbortController();
    runSpawnMock.mockImplementationOnce(async () => {
      // Cancellation arrives while `down` is in flight — `down` itself
      // still completes (no `--volumes`, so it is safe either way), but
      // the retry must not fire afterward.
      controller.abort();
      return spawnResult();
    });

    const result = await recreateProjectNonDestructively({
      composeDir: COMPOSE_DIR,
      installId: INSTALL_ID,
      signal: controller.signal,
    });

    expect(runSpawnMock).toHaveBeenCalledTimes(1); // only `down` ran
    expect(result.downResult.code).toBe(0);
    expect(result.upResult.aborted).toBe(true);
  });

  it("propagates the up -d failure result when the retry itself fails", async () => {
    runSpawnMock
      .mockResolvedValueOnce(spawnResult()) // down
      .mockResolvedValueOnce(spawnResult({ code: 1, stderr: "still stale" })); // up retry

    const result = await recreateProjectNonDestructively({
      composeDir: COMPOSE_DIR,
      installId: INSTALL_ID,
    });

    expect(result.upResult.code).toBe(1);
    expect(result.upResult.stderr).toContain("still stale");
  });
});
