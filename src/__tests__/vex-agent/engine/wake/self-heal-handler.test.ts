/**
 * Overnight self-heal wake handler — routing + model failover + kill switch.
 * Drives the pure `tick` with an injected `WakeDeps`; the dynamic-import claim,
 * lease helpers, and the model-failover module are mocked so no DB is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockClaimRunForSelfHeal = vi.fn();
const mockClaimRunLeaseAndFlipToRunning = vi.fn();
const mockClaimRunForAutoRetry = vi.fn();
const mockReleaseLease = vi.fn().mockResolvedValue(undefined);
const mockCreateLeaseHandle = vi.fn().mockReturnValue({ ownerId: "o" });
const applyModelFailover = vi.fn();
const restorePrimaryModel = vi.fn();

vi.mock("@vex-agent/engine/runtime/lease-and-status.js", () => ({
  claimRunForSelfHeal: (...a: unknown[]) => mockClaimRunForSelfHeal(...a),
  claimRunLeaseAndFlipToRunning: (...a: unknown[]) => mockClaimRunLeaseAndFlipToRunning(...a),
  claimRunForAutoRetry: (...a: unknown[]) => mockClaimRunForAutoRetry(...a),
  claimSessionLease: vi.fn(),
  observeAndApplyControl: vi.fn().mockResolvedValue({ outcome: "no_request" }),
}));
vi.mock("@vex-agent/engine/runtime/lease-handle.js", () => ({
  createLeaseHandle: (...a: unknown[]) => mockCreateLeaseHandle(...a),
}));
vi.mock("@vex-agent/engine/runtime/release-and-emit.js", () => ({
  releaseLeaseAndEmitControlState: (...a: unknown[]) => mockReleaseLease(...a),
}));
vi.mock("@vex-agent/engine/self-heal/model-failover.js", () => ({
  applyModelFailover: (...a: unknown[]) => applyModelFailover(...a),
  restorePrimaryModel: (...a: unknown[]) => restorePrimaryModel(...a),
}));

const { tick } = await import("@vex-agent/engine/wake/executor.js");
import type { WakeDeps } from "@vex-agent/engine/wake/executor.js";
import type { LoopWakeRequest } from "@vex-agent/db/repos/loop-wake.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";

function selfHealWake(payload: Record<string, unknown>): LoopWakeRequest {
  return {
    id: "w-1",
    sessionId: "s-1",
    missionRunId: "run-1",
    dueAt: "2026-07-25T02:00:00.000Z",
    status: "consumed",
    reason: "self_heal retry",
    payload,
    createdAt: "2026-07-25T01:59:00.000Z",
    consumedAt: "2026-07-25T02:00:01.000Z",
    cancelledAt: null,
    cancelledReason: null,
  };
}

function pausedErrorRun(): MissionRun {
  return {
    id: "run-1",
    missionId: "m-1",
    sessionId: "s-1",
    status: "paused_error",
    startedAt: "2026-07-25T01:50:00.000Z",
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: "provider_error",
    stopSummary: null,
    stopEvidenceJson: { classified: "transient" },
    iterationCount: 1,
    contractSnapshotJson: { frozenMission: { constraintsJson: { durationMinutes: 60 } } },
    recoveredFromRunId: null,
    errorRetryCount: 3,
    autoRetryUnsafe: false,
  };
}

function deps(run: MissionRun | null, over: Partial<WakeDeps> = {}): WakeDeps {
  return {
    claimDue: async () => (run ? [selfHealWake({ trigger: "self_heal_retry", attempt: 3 })] : []),
    getMissionRun: async () => run,
    casFlipToRunning: async () => "paused_error",
    injectWakeBanner: vi.fn().mockResolvedValue(undefined),
    resumeMissionRun: vi.fn().mockResolvedValue(undefined),
    isProviderReady: () => true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateLeaseHandle.mockReturnValue({ ownerId: "o" });
  delete process.env.AGENT_SELF_HEAL_ENABLED;
});
afterEach(() => {
  delete process.env.AGENT_SELF_HEAL_ENABLED;
});

describe("handleSelfHealClaimed routing", () => {
  it("failover:true → applies the backup model, claims, and resumes", async () => {
    mockClaimRunForSelfHeal.mockResolvedValue({ outcome: "claimed", lease: {} });
    const d = deps(pausedErrorRun(), {
      claimDue: async () => [selfHealWake({ trigger: "self_heal_retry", attempt: 3, failover: true })],
    });

    const results = await tick(new Date(), 10, d);

    expect(applyModelFailover).toHaveBeenCalledTimes(1);
    expect(restorePrimaryModel).not.toHaveBeenCalled();
    expect(mockClaimRunForSelfHeal).toHaveBeenCalledTimes(1);
    expect(d.resumeMissionRun).toHaveBeenCalledWith("run-1");
    expect(results[0].outcome).toEqual({ kind: "resumed", runId: "run-1" });
  });

  it("failover:false → restores the primary model before resuming", async () => {
    mockClaimRunForSelfHeal.mockResolvedValue({ outcome: "claimed", lease: {} });
    const d = deps(pausedErrorRun(), {
      claimDue: async () => [selfHealWake({ trigger: "self_heal_retry", attempt: 3, failover: false })],
    });

    await tick(new Date(), 10, d);
    expect(restorePrimaryModel).toHaveBeenCalledTimes(1);
    expect(applyModelFailover).not.toHaveBeenCalled();
  });

  it("kill switch disabled → drops the wake without claiming or resuming", async () => {
    process.env.AGENT_SELF_HEAL_ENABLED = "false";
    const resumeMissionRun = vi.fn().mockResolvedValue(undefined);
    const d = deps(pausedErrorRun(), { resumeMissionRun });

    const results = await tick(new Date(), 10, d);
    expect(mockClaimRunForSelfHeal).not.toHaveBeenCalled();
    expect(resumeMissionRun).not.toHaveBeenCalled();
    expect(results[0].outcome).toEqual({ kind: "skipped_claim_lost" });
  });

  it("claim ineligible (e.g. human Recover raced) → no resume", async () => {
    mockClaimRunForSelfHeal.mockResolvedValue({ outcome: "ineligible", reason: "unsafe" });
    const resumeMissionRun = vi.fn().mockResolvedValue(undefined);
    const d = deps(pausedErrorRun(), { resumeMissionRun });

    await tick(new Date(), 10, d);
    expect(resumeMissionRun).not.toHaveBeenCalled();
  });
});
