/**
 * updateCandidateOutcome SQL mapping unit tests (S5 §8). Mocks the db client to
 * assert the precondition (`status = 'pending'`), the column writes (outcome
 * JSONB + available_at_decision_time + updated_at), and the ok / not_found /
 * precondition_failed result mapping — without a live Postgres.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";

let mockQueryOneWith: Mock<(exec: unknown, sql: string, params?: unknown[]) => Promise<unknown>>;

function resetMocks() {
  mockQueryOneWith = vi.fn();
}
resetMocks();

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: vi.fn(() => ({})),
  queryOneWith: (exec: unknown, sql: string, params?: unknown[]) =>
    mockQueryOneWith(exec, sql, params),
  queryWith: vi.fn().mockResolvedValue([]),
}));

const { updateCandidateOutcome } = await import("@vex-agent/db/repos/memory-candidates/crud.js");

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";

function outcome(over: Partial<MemoryOutcomeSummary> = {}): MemoryOutcomeSummary {
  return {
    status: "closed",
    productType: "spot",
    lessonSignal: "positive",
    evidenceQuality: "strong",
    pointInTimeChecked: true,
    outcomeComputedBy: "memory_manager",
    outcomeVersion: 0,
    needsReconciliation: false,
    pnlSource: "pnl_matches",
    ...over,
  };
}

beforeEach(() => {
  resetMocks();
});

describe("updateCandidateOutcome — SQL mapping", () => {
  it("returns not_found for an empty id without touching the db", async () => {
    const res = await updateCandidateOutcome("", outcome(), null);
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(mockQueryOneWith).not.toHaveBeenCalled();
  });

  it("writes outcome + boundary guarded on status='pending' and returns ok", async () => {
    mockQueryOneWith.mockResolvedValueOnce({ id: CANDIDATE_ID });
    const boundary = new Date("2026-06-01T00:00:00.000Z");
    const res = await updateCandidateOutcome(CANDIDATE_ID, outcome(), boundary);

    expect(res).toEqual({ ok: true });
    const [, sql, params] = mockQueryOneWith.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toContain("UPDATE memory_candidates");
    expect(sql).toContain("outcome = $2::jsonb");
    expect(sql).toContain("available_at_decision_time = $3::timestamptz");
    expect(sql).toContain("updated_at = NOW()");
    expect(sql).toContain("WHERE id = $1 AND status = 'pending'");
    expect(params[0]).toBe(CANDIDATE_ID);
    // jsonb(outcome) is passed through; boundary is serialized to ISO.
    expect(params[2]).toBe(boundary.toISOString());
  });

  it("passes a null boundary through (point-in-time degraded, never rejected)", async () => {
    mockQueryOneWith.mockResolvedValueOnce({ id: CANDIDATE_ID });
    await updateCandidateOutcome(CANDIDATE_ID, outcome({ pointInTimeChecked: false }), null);
    const [, , params] = mockQueryOneWith.mock.calls[0] as [unknown, string, unknown[]];
    expect(params[2]).toBeNull();
  });

  it("maps a zero-row update on an existing non-pending row to precondition_failed", async () => {
    mockQueryOneWith
      .mockResolvedValueOnce(null) // UPDATE matched no row
      .mockResolvedValueOnce({ status: "promoted" }); // follow-up SELECT
    const res = await updateCandidateOutcome(CANDIDATE_ID, outcome(), null);
    expect(res).toEqual({ ok: false, reason: "precondition_failed", currentStatus: "promoted" });
  });

  it("maps a zero-row update on a missing row to not_found", async () => {
    mockQueryOneWith
      .mockResolvedValueOnce(null) // UPDATE matched no row
      .mockResolvedValueOnce(null); // follow-up SELECT → gone
    const res = await updateCandidateOutcome(CANDIDATE_ID, outcome(), null);
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
