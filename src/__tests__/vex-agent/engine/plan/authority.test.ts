/**
 * Plan-mode engine authority — `acceptSessionPlan` optimistic-concurrency guard.
 *
 * Codex final-review blocker: accept must NOT mark a plan version the user did
 * not review. `setAccepted` is content-conditional (WHERE plan_md = expected);
 * a miss (concurrent `plan_write` changed the content) returns null → the
 * authority maps it to `stale`, never accepting the unreviewed content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockGetActivePlan = vi.fn();
const mockSetAccepted = vi.fn();

vi.mock("../../../../vex-agent/db/client.js", () => ({
  // Run the transaction callback with a stub client.
  withTransaction: (fn: (client: unknown) => unknown) => fn({}),
}));
vi.mock("../../../../vex-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
}));
vi.mock("../../../../vex-agent/db/repos/session-plans.js", () => ({
  getActivePlan: (...a: unknown[]) => mockGetActivePlan(...a),
  setAccepted: (...a: unknown[]) => mockSetAccepted(...a),
}));

const { acceptSessionPlan } = await import(
  "../../../../vex-agent/engine/plan/authority.js"
);

const PLAN = {
  sessionId: "s1",
  enabled: true,
  planMd: "# reviewed plan",
  acceptedAt: null,
  accepted: false,
  offNoticePending: false,
  createdAt: "t",
  updatedAt: "t",
};

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetActivePlan.mockReset();
  mockSetAccepted.mockReset();
  mockGetSession.mockResolvedValue({ id: "s1" });
  mockGetActivePlan.mockResolvedValue(PLAN);
});

describe("acceptSessionPlan", () => {
  it("returns stale when the content changed since review (conditional accept missed)", async () => {
    mockSetAccepted.mockResolvedValue(null); // WHERE plan_md = expected matched nothing
    const out = await acceptSessionPlan("s1", "# OLD content the user reviewed");
    expect(out.outcome).toBe("stale");
    // The reviewed content is what gets matched — never blindly accepted.
    expect(mockSetAccepted).toHaveBeenCalledWith(
      "s1",
      "# OLD content the user reviewed",
      expect.anything(),
    );
  });

  it("returns ok when the stored content still matches what was reviewed", async () => {
    mockSetAccepted.mockResolvedValue({ ...PLAN, accepted: true, acceptedAt: "now" });
    const out = await acceptSessionPlan("s1", "# reviewed plan");
    expect(out.outcome).toBe("ok");
  });

  it("returns not_found for an unknown session", async () => {
    mockGetSession.mockResolvedValue(null);
    const out = await acceptSessionPlan("s1", "x");
    expect(out.outcome).toBe("not_found");
    expect(mockSetAccepted).not.toHaveBeenCalled();
  });

  it("returns no_plan when plan-mode is off or no plan exists", async () => {
    mockGetActivePlan.mockResolvedValue({ ...PLAN, enabled: false });
    const out = await acceptSessionPlan("s1", "x");
    expect(out.outcome).toBe("no_plan");
    expect(mockSetAccepted).not.toHaveBeenCalled();
  });
});
