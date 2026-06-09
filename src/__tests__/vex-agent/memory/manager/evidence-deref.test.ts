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

  it("is moderate at recurrence >= 2 and NEVER strong in S4", () => {
    expect(deriveEvidenceStrengthCeiling({ anchorExists: true, recurrenceCount: 2 })).toBe("moderate");
    expect(deriveEvidenceStrengthCeiling({ anchorExists: true, recurrenceCount: 99 })).toBe("moderate");
  });
});
