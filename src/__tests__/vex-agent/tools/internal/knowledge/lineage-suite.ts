import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function lineageSuite(ctx: SuiteCtx): void {
  const { handleKnowledgeLineage, makeTestContext, mockGetLineageChain } = ctx;

  describe("handleKnowledgeLineage", () => {
    it("fails on missing id", async () => {
      const result = await handleKnowledgeLineage({}, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing required parameter: id");
    });

    it("fails when repo returns null (entry not found)", async () => {
      mockGetLineageChain.mockResolvedValueOnce(null);
      const result = await handleKnowledgeLineage({ id: 999 }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("999");
    });

    it("happy path returns chain + headId + headStatus + chainLength", async () => {
      mockGetLineageChain.mockResolvedValueOnce({
        requestedId: 2,
        headId: 3,
        headStatus: "active",
        chain: [
          { id: 1, kind: "risk_rule", title: "v1", status: "superseded", supersedesId: null, statusReason: null, changeSummary: null, whatFailed: null, validFrom: "2026-04-01T00:00:00Z", validUntil: null, updatedAt: "2026-04-02T00:00:00Z" },
          { id: 2, kind: "risk_rule", title: "v2", status: "superseded", supersedesId: 1, statusReason: null, changeSummary: "5%", whatFailed: null, validFrom: "2026-04-02T00:00:00Z", validUntil: null, updatedAt: "2026-04-05T00:00:00Z" },
          { id: 3, kind: "risk_rule", title: "v3", status: "active", supersedesId: 2, statusReason: null, changeSummary: "3%", whatFailed: null, validFrom: "2026-04-05T00:00:00Z", validUntil: null, updatedAt: "2026-04-10T00:00:00Z" },
        ],
      });
      const result = await handleKnowledgeLineage({ id: 2 }, makeTestContext());
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.requestedId).toBe(2);
      expect(parsed.headId).toBe(3);
      expect(parsed.headStatus).toBe("active");
      expect(parsed.chainLength).toBe(3);
      expect(parsed.chain.map((c: { id: number }) => c.id)).toEqual([1, 2, 3]);
    });

    it("does NOT inject anything into loadedDocuments (browse, not context load)", async () => {
      mockGetLineageChain.mockResolvedValueOnce({
        requestedId: 5,
        headId: 5,
        headStatus: "active",
        chain: [
          { id: 5, kind: "memo", title: "lone", status: "active", supersedesId: null, statusReason: null, changeSummary: null, whatFailed: null, validFrom: "2026-04-01T00:00:00Z", validUntil: null, updatedAt: "2026-04-01T00:00:00Z" },
        ],
      });
      const engineCtx = makeTestContext();
      await handleKnowledgeLineage({ id: 5 }, engineCtx);
      expect(engineCtx.loadedDocuments.size).toBe(0);
    });

    it("propagates terminated head status (e.g. invalidated chain)", async () => {
      mockGetLineageChain.mockResolvedValueOnce({
        requestedId: 1,
        headId: 2,
        headStatus: "invalidated",
        chain: [
          { id: 1, kind: "risk_rule", title: "v1", status: "superseded", supersedesId: null, statusReason: null, changeSummary: null, whatFailed: null, validFrom: "2026-04-01T00:00:00Z", validUntil: null, updatedAt: "2026-04-02T00:00:00Z" },
          { id: 2, kind: "risk_rule", title: "v2", status: "invalidated", supersedesId: 1, statusReason: "wrong assumption", changeSummary: null, whatFailed: null, validFrom: "2026-04-02T00:00:00Z", validUntil: null, updatedAt: "2026-04-08T00:00:00Z" },
        ],
      });
      const result = await handleKnowledgeLineage({ id: 1 }, makeTestContext());
      const parsed = JSON.parse(result.output);
      expect(parsed.headStatus).toBe("invalidated");
      expect(parsed.chain[1]!.statusReason).toBe("wrong assumption");
    });
  });
}
