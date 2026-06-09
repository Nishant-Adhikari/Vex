/**
 * Boundary-schema accept/reject tests for `memoryOutcomeSummarySchema` (S5).
 *
 * The outcome is JSONB-only (no SQL CHECK), so this Zod schema is the SOLE
 * validation boundary. Pins the genesis §227-237 shape + `pnlSource`, the strict
 * unknown-key rejection (a stray proj_* SERIAL or raw monetary field can never
 * leak in), and the optional fields.
 */

import { describe, it, expect } from "vitest";

import { memoryOutcomeSummarySchema } from "@vex-agent/memory/schema/memory-outcome.js";

const VALID_CLOSED = {
  status: "closed",
  productType: "spot",
  lessonSignal: "positive",
  evidenceQuality: "strong",
  pointInTimeChecked: true,
  outcomeComputedBy: "memory_manager",
  outcomeVersion: 0,
  needsReconciliation: false,
  pnlSource: "pnl_matches",
} as const;

describe("memoryOutcomeSummarySchema", () => {
  it("accepts a full closed spot outcome", () => {
    const res = memoryOutcomeSummarySchema.safeParse(VALID_CLOSED);
    expect(res.success).toBe(true);
  });

  it("accepts the minimal required fields (optionals absent)", () => {
    const res = memoryOutcomeSummarySchema.safeParse({
      status: "open",
      lessonSignal: "neutral",
      evidenceQuality: "weak",
      pointInTimeChecked: false,
      outcomeComputedBy: "memory_manager",
      outcomeVersion: 0,
    });
    expect(res.success).toBe(true);
  });

  it("accepts an ISO outcomeLastChangedAt stamp", () => {
    const res = memoryOutcomeSummarySchema.safeParse({
      ...VALID_CLOSED,
      outcomeLastChangedAt: "2026-06-09T12:00:00.000Z",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an unknown key (a stray proj_* SERIAL or raw monetary field)", () => {
    expect(
      memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, pnlMatchId: 42 }).success,
    ).toBe(false);
    expect(
      memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, realizedPnlUsd: "12.34" }).success,
    ).toBe(false);
  });

  it("rejects an out-of-vocabulary status / lessonSignal / evidenceQuality / pnlSource", () => {
    expect(memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, status: "won" }).success).toBe(false);
    expect(
      memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, lessonSignal: "great" }).success,
    ).toBe(false);
    expect(
      memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, evidenceQuality: "excellent" }).success,
    ).toBe(false);
    expect(
      memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, pnlSource: "magic" }).success,
    ).toBe(false);
  });

  it("rejects a negative outcomeVersion and a non-boolean pointInTimeChecked", () => {
    expect(memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, outcomeVersion: -1 }).success).toBe(
      false,
    );
    expect(
      memoryOutcomeSummarySchema.safeParse({ ...VALID_CLOSED, pointInTimeChecked: "yes" }).success,
    ).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { evidenceQuality, ...withoutQuality } = VALID_CLOSED;
    void evidenceQuality;
    expect(memoryOutcomeSummarySchema.safeParse(withoutQuality).success).toBe(false);
  });
});
