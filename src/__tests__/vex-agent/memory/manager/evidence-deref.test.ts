/**
 * Light evidence deref unit tests — anchor existence + OD-3 block, recurrence
 * count, and the S4 evidence-strength ceiling (never 'strong').
 */

import { describe, it, expect } from "vitest";

import {
  derefAnchorExistence,
  countRecurrence,
  deriveEvidenceStrengthCeiling,
} from "@vex-agent/memory/manager/evidence-deref.js";
import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";

function closedStrongOutcome(over: Partial<MemoryOutcomeSummary> = {}): MemoryOutcomeSummary {
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

describe("derefAnchorExistence", () => {
  it("reports anchor existence and counts distinct executions", async () => {
    const anchors: EvidenceRefs = [
      { executionId: 5 },
      { executionId: 5, captureItemId: 9 }, // same execution → counted once
      { executionId: 6 },
    ];
    const res = await derefAnchorExistence(anchors, {
      getExecutionSession: async () => ({ sessionId: "s1" }),
      isSessionSoftDeleted: async () => false,
    });
    expect(res.anchorExists).toBe(true);
    expect(res.existingExecutionCount).toBe(2);
    expect(res.softDeleted).toBe(false);
  });

  it("blocks (softDeleted) when an anchor's session is soft-deleted (OD-3)", async () => {
    const anchors: EvidenceRefs = [{ executionId: 5 }];
    const res = await derefAnchorExistence(anchors, {
      getExecutionSession: async () => ({ sessionId: "s1" }),
      isSessionSoftDeleted: async () => true,
    });
    expect(res.softDeleted).toBe(true);
  });

  it("treats a missing execution as non-existent (FIX-1 replay safety)", async () => {
    const anchors: EvidenceRefs = [{ executionId: 5 }];
    const res = await derefAnchorExistence(anchors, {
      getExecutionSession: async () => null,
      isSessionSoftDeleted: async () => false,
    });
    expect(res.anchorExists).toBe(false);
    expect(res.existingExecutionCount).toBe(0);
  });
});

describe("countRecurrence", () => {
  it("counts distinct executions across the candidate and its cluster", () => {
    const candidate: EvidenceRefs = [{ executionId: 5 }];
    const cluster: EvidenceRefs[] = [[{ executionId: 6 }], [{ executionId: 5 }, { executionId: 7 }]];
    expect(countRecurrence(candidate, cluster)).toBe(3); // {5,6,7}
  });

  it("is 1 for a single anchored fact with no recurring cluster", () => {
    expect(countRecurrence([{ executionId: 5 }], [])).toBe(1);
  });
});

describe("deriveEvidenceStrengthCeiling", () => {
  it("is none when no anchor exists", () => {
    expect(deriveEvidenceStrengthCeiling({ anchorExists: false, recurrenceCount: 5 })).toBe("none");
  });

  it("is weak with an anchor but recurrence < 2", () => {
    expect(deriveEvidenceStrengthCeiling({ anchorExists: true, recurrenceCount: 1 })).toBe("weak");
  });

  it("is moderate at recurrence >= 2 and NEVER strong without an outcome (S4 behavior)", () => {
    expect(deriveEvidenceStrengthCeiling({ anchorExists: true, recurrenceCount: 2 })).toBe("moderate");
    expect(deriveEvidenceStrengthCeiling({ anchorExists: true, recurrenceCount: 99 })).toBe("moderate");
  });
});

describe("deriveEvidenceStrengthCeiling — S5 outcome-aware 'strong'", () => {
  it("is strong for a trade-family closed realized outcome that is point-in-time checked", () => {
    expect(
      deriveEvidenceStrengthCeiling({
        anchorExists: true,
        recurrenceCount: 1,
        isTradeKind: true,
        outcome: closedStrongOutcome(),
      }),
    ).toBe("strong");
  });

  it("does NOT reach strong for a non-trade kind even with a closed strong outcome", () => {
    expect(
      deriveEvidenceStrengthCeiling({
        anchorExists: true,
        recurrenceCount: 1,
        isTradeKind: false,
        outcome: closedStrongOutcome(),
      }),
    ).toBe("weak");
  });

  it("caps at moderate for an OPEN/unrealized outcome (never strong)", () => {
    expect(
      deriveEvidenceStrengthCeiling({
        anchorExists: true,
        recurrenceCount: 2,
        isTradeKind: true,
        outcome: closedStrongOutcome({ status: "open", evidenceQuality: "weak", lessonSignal: "neutral" }),
      }),
    ).toBe("moderate");
  });

  it("does NOT reach strong when point-in-time is unchecked (degrades to the S4 ceiling)", () => {
    expect(
      deriveEvidenceStrengthCeiling({
        anchorExists: true,
        recurrenceCount: 1,
        isTradeKind: true,
        outcome: closedStrongOutcome({ pointInTimeChecked: false }),
      }),
    ).toBe("weak");
  });

  it("does NOT reach strong when the outcome evidenceQuality is only medium (closed thin venue)", () => {
    expect(
      deriveEvidenceStrengthCeiling({
        anchorExists: true,
        recurrenceCount: 2,
        isTradeKind: true,
        outcome: closedStrongOutcome({ evidenceQuality: "medium" }),
      }),
    ).toBe("moderate");
  });
});
