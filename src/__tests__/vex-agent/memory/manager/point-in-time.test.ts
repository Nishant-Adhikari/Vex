/**
 * Point-in-time / no-lookahead unit tests (S5 §6). Boundary derivation
 * (eventTime → earliest anchor created_at → null) and the conservative
 * `pointInTimeChecked` flag (derivable boundary → true; NULL boundary → false).
 * The outcome is derived from immutable ledger facts, so it is never lookahead
 * input — these tests pin the AUDIT boundary, not an exclusion of outcome anchors.
 */

import { describe, it, expect } from "vitest";

import {
  deriveDecisionBoundary,
  checkNoLookahead,
} from "@vex-agent/memory/manager/point-in-time.js";
import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";

describe("deriveDecisionBoundary", () => {
  it("uses the agent-supplied eventTime when present (no anchor lookup needed)", async () => {
    let looked = false;
    const boundary = await deriveDecisionBoundary(
      { eventTime: "2026-06-01T10:00:00.000Z", evidenceRefs: [{ executionId: 5 }] },
      {
        getExecutionTime: async () => {
          looked = true;
          return { createdAt: "2026-01-01T00:00:00.000Z" };
        },
      },
    );
    expect(boundary?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(looked).toBe(false);
  });

  it("falls back to the EARLIEST anchor created_at when no eventTime", async () => {
    const refs: EvidenceRefs = [{ executionId: 5 }, { executionId: 6 }];
    const times: Record<number, string> = {
      5: "2026-06-02T00:00:00.000Z",
      6: "2026-06-01T00:00:00.000Z", // earlier
    };
    const boundary = await deriveDecisionBoundary(
      { eventTime: null, evidenceRefs: refs },
      { getExecutionTime: async (id) => ({ createdAt: times[id] }) },
    );
    expect(boundary?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("skips a missing anchor and still derives from the surviving one (FIX-1 replay safety)", async () => {
    const refs: EvidenceRefs = [{ executionId: 5 }, { executionId: 6 }];
    const boundary = await deriveDecisionBoundary(
      { eventTime: null, evidenceRefs: refs },
      {
        getExecutionTime: async (id) =>
          id === 6 ? { createdAt: "2026-06-05T00:00:00.000Z" } : null,
      },
    );
    expect(boundary?.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("returns null when there is no eventTime and every anchor is gone", async () => {
    const boundary = await deriveDecisionBoundary(
      { eventTime: null, evidenceRefs: [{ executionId: 5 }] },
      { getExecutionTime: async () => null },
    );
    expect(boundary).toBeNull();
  });

  it("returns null with no eventTime and no anchors", async () => {
    const boundary = await deriveDecisionBoundary(
      { eventTime: null, evidenceRefs: [] },
      { getExecutionTime: async () => null },
    );
    expect(boundary).toBeNull();
  });
});

describe("checkNoLookahead", () => {
  it("is true for a derivable boundary (outcome is derived, not lookahead input)", () => {
    expect(checkNoLookahead(new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("is false for a NULL boundary (degrades strong, never rejects)", () => {
    expect(checkNoLookahead(null)).toBe(false);
  });
});
