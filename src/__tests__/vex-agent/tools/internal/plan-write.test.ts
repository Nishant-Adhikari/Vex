/**
 * plan_write handler — atomic enabled-guard + pause semantics.
 *
 * Codex holistic-review blocker: a disable that races between the handler's
 * `getActivePlan` read and the `upsertPlan` write must NOT leave the run parked
 * with a disabled, unaccepted plan. `upsertPlan` returns null in that race (the
 * DB-level enabled-guard skipped the write); the handler then fails WITHOUT
 * emitting a `plan_pause` signal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetActivePlan = vi.fn();
const mockUpsertPlan = vi.fn();

vi.mock("@vex-agent/db/repos/session-plans.js", () => ({
  getActivePlan: (...a: unknown[]) => mockGetActivePlan(...a),
  upsertPlan: (...a: unknown[]) => mockUpsertPlan(...a),
}));

const { handlePlanWrite } = await import(
  "../../../../vex-agent/tools/internal/plan/write.js"
);

type Ctx = Parameters<typeof handlePlanWrite>[1];
function ctx(missionRunId: string | null): Ctx {
  return { sessionId: "s1", missionRunId } as unknown as Ctx;
}
const ARGS = { plan_md: "# Action Plan\n\n## 1. Objective\nshipped" };

const ENABLED_UNACCEPTED = {
  sessionId: "s1", enabled: true, planMd: "# old", acceptedAt: null,
  accepted: false, offNoticePending: false, createdAt: "t", updatedAt: "t",
};

beforeEach(() => {
  mockGetActivePlan.mockReset();
  mockUpsertPlan.mockReset();
  mockGetActivePlan.mockResolvedValue(ENABLED_UNACCEPTED);
});

describe("handlePlanWrite", () => {
  it("fails when plan-mode is not enabled (defense-in-depth)", async () => {
    mockGetActivePlan.mockResolvedValue({ ...ENABLED_UNACCEPTED, enabled: false });
    const res = await handlePlanWrite(ARGS, ctx("run-1"));
    expect(res.success).toBe(false);
    expect(mockUpsertPlan).not.toHaveBeenCalled();
  });

  it("fails WITHOUT a pause signal when disable races before the write (upsert returns null)", async () => {
    mockUpsertPlan.mockResolvedValue(null); // atomic enabled-guard skipped the write
    const res = await handlePlanWrite(ARGS, ctx("run-1"));
    expect(res.success).toBe(false);
    expect(res.engineSignal).toBeUndefined(); // run must NOT be parked
  });

  it("emits plan_pause in an active mission run when acceptance is pending", async () => {
    mockUpsertPlan.mockResolvedValue({ ...ENABLED_UNACCEPTED, planMd: "# new", accepted: false });
    const res = await handlePlanWrite(ARGS, ctx("run-1"));
    expect(res.success).toBe(true);
    expect(res.engineSignal?.type).toBe("plan_pause");
    expect(res.engineSignal?.reason).toBe("plan_acceptance_required");
  });

  it("does NOT emit a signal in an agent session (no run to pause)", async () => {
    mockUpsertPlan.mockResolvedValue({ ...ENABLED_UNACCEPTED, planMd: "# new", accepted: false });
    const res = await handlePlanWrite(ARGS, ctx(null));
    expect(res.success).toBe(true);
    expect(res.engineSignal).toBeUndefined();
  });
});
