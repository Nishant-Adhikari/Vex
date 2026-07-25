/**
 * LIFECYCLE GUARD — Finalize integrity (#8) + orphan-reconcile ledger tail (#1).
 *
 * Two guarded behaviors:
 *
 *   1. LEDGER COHERENCE — a completed run writes a mission_results row whose
 *      outcome / stop_reason / pnl / trades are mutually coherent. Driven
 *      through `captureMissionFinal` with injected deps (the real repos hit the
 *      DB). This is the "coherent record" assertion the existing split coverage
 *      lacked: the finalize unit tests MOCK captureMissionFinal, and the
 *      captureMissionFinal unit test asserts the fields but not from the mapped
 *      terminal status finalize actually passes.
 *
 *   2. STATUS MAPPING — `finalizeMissionRunStatus` maps the loop's stopReason to
 *      the right terminal status AND closes the ledger with a matching outcome:
 *        - goal_reached -> mission `completed`, ledger outcome `completed`
 *        - runner_lost  -> race-safe claim; on win, mission `cancelled` + ledger
 *          outcome `stopped`; on a LOST claim it is a no-op-safe finalize
 *          (still `cancelled`, no double ledger close) — the #56 reconcile path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Block 1: captureMissionFinal ledger coherence (injected deps) ──
// Block 2 (below) mocks this whole module for the finalize mapping tests, and
// vi.mock is hoisted file-wide — so pull the REAL implementations via
// importActual here so block 1 exercises the genuine ledger writer.
import type { CaptureDeps } from "@vex-agent/engine/mission/mission-results-capture.js";
const { captureMissionFinal, computePnl } = await vi.importActual<
  typeof import("@vex-agent/engine/mission/mission-results-capture.js")
>("@vex-agent/engine/mission/mission-results-capture.js");

function captureDeps(over: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    getMission: vi.fn(async () => ({
      id: "mission-1",
      allowedWallets: ["0xWALLET"],
      allowedChains: ["robinhood"],
      goal: "grind robinhood-chain memecoins",
    })) as never,
    readBankrollOnChain: vi.fn(async () => ({ bankrollEth: 1.25, ethPriceUsd: 3000, openPositions: [] })) as never,
    readBankroll: vi.fn(async () => ({ bankrollEth: 1.2, ethPriceUsd: 3000, openPositions: [] })) as never,
    openResult: vi.fn(async () => {}) as never,
    closeResult: vi.fn(async () => {}) as never,
    getResult: vi.fn(async () => ({
      startedAt: "2026-07-22T12:00:00.000Z",
      bankrollStartEth: 1.0,
    })) as never,
    countTrades: vi.fn(async () => 4) as never,
    getRun: vi.fn(async () => ({ mode: "live" })) as never,
    ...over,
  };
}

describe("mission_results ledger coherence (captureMissionFinal)", () => {
  it("computePnl is an honest ETH delta + percent vs start", () => {
    expect(computePnl(1.0, 1.25)).toEqual({ pnlEth: expect.closeTo(0.25, 10), pnlPct: expect.closeTo(25, 10) });
    expect(computePnl(null, 1.25)).toEqual({ pnlEth: null, pnlPct: null });
  });

  it("closes with a coherent outcome + stop_reason + pnl + trades for a completed run", async () => {
    const deps = captureDeps();
    await captureMissionFinal(
      { missionId: "mission-1", runId: "run-1", sessionId: "sess-1", outcome: "completed", stopReason: "goal_reached" },
      deps,
    );
    expect(deps.closeResult).toHaveBeenCalledTimes(1);
    const row = (deps.closeResult as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row).toMatchObject({
      missionRunId: "run-1",
      outcome: "completed",
      stopReason: "goal_reached",
      // On-chain end (1.25) vs start (1.0) -> +0.25 ETH / +25%.
      bankrollEndEth: 1.25,
      trades: 4,
    });
    expect(row.pnlEth).toBeCloseTo(0.25, 10);
    expect(row.pnlPct).toBeCloseTo(25, 10);
  });

  it("is a no-op when no ledger row was ever opened (never closes a phantom row)", async () => {
    const deps = captureDeps({ getResult: vi.fn(async () => null) as never });
    await captureMissionFinal(
      { missionId: "mission-1", runId: "run-1", sessionId: "sess-1", outcome: "failed", stopReason: "system_error" },
      deps,
    );
    expect(deps.closeResult).not.toHaveBeenCalled();
  });
});

// ── Block 2: finalizeMissionRunStatus status/outcome mapping ──
const setStatus = vi.fn().mockResolvedValue(undefined);
const updateStatus = vi.fn().mockResolvedValue(undefined);
const markStoppedIfRunning = vi.fn().mockResolvedValue(true);
const getRun = vi.fn().mockResolvedValue({ id: "run-1", status: "stopped", stopReason: "runner_lost" });
const getLease = vi.fn().mockResolvedValue(null);
const captureFinal = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => setStatus(...a),
  clearApprovedAt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => updateStatus(...a),
  markStoppedIfRunning: (...a: unknown[]) => markStoppedIfRunning(...a),
  getRun: (...a: unknown[]) => getRun(...a),
}));
vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  getLease: (...a: unknown[]) => getLease(...a),
}));
vi.mock("@vex-agent/engine/mission/mission-results-capture.js", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, captureMissionFinal: (...a: unknown[]) => captureFinal(...a) };
});
vi.mock("@vex-agent/engine/runtime/control-bus.js", () => ({
  controlStateBus: { emit: vi.fn() },
  CONTROL_STATE_EVENT_TYPE: "control_state",
}));
vi.mock("@vex-agent/engine/core/runner/abort.js", () => ({
  consumeMissionRunAbortIntent: vi.fn().mockReturnValue(null),
}));
vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { finalizeMissionRunStatus } = await import(
  "@vex-agent/engine/core/runner/mission-finalize.js"
);

describe("finalizeMissionRunStatus — terminal status/outcome mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markStoppedIfRunning.mockResolvedValue(true);
    getRun.mockResolvedValue({ id: "run-1", status: "stopped", stopReason: "runner_lost" });
    getLease.mockResolvedValue(null);
  });

  it("goal_reached -> mission completed + ledger outcome 'completed'", async () => {
    const status = await finalizeMissionRunStatus("mission-1", "run-1", "sess-1", "goal_reached");
    expect(status).toBe("completed");
    expect(setStatus).toHaveBeenCalledWith("mission-1", "completed");
    expect(updateStatus).toHaveBeenCalledWith("run-1", "completed", "goal_reached", undefined);
    expect(captureFinal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed", stopReason: "goal_reached" }),
    );
  });

  it("runner_lost (orphan reclaim) -> claim, mission cancelled, ledger outcome 'stopped'", async () => {
    const status = await finalizeMissionRunStatus("mission-1", "run-1", "sess-1", "runner_lost");
    expect(status).toBe("cancelled");
    expect(markStoppedIfRunning).toHaveBeenCalledWith("run-1", "runner_lost", undefined);
    expect(setStatus).toHaveBeenCalledWith("mission-1", "cancelled");
    expect(captureFinal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "stopped", stopReason: "runner_lost" }),
    );
  });

  it("runner_lost with a LOST claim is a no-op-safe finalize (cancelled, no double ledger close)", async () => {
    markStoppedIfRunning.mockResolvedValueOnce(false); // resumed / already terminal
    const status = await finalizeMissionRunStatus("mission-1", "run-1", "sess-1", "runner_lost");
    expect(status).toBe("cancelled");
    expect(setStatus).not.toHaveBeenCalled();
    expect(captureFinal).not.toHaveBeenCalled();
  });
});
