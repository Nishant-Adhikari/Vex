import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function historySuite(ctx: SuiteCtx): void {
  const { handleKnowledgeHistory, makeTestContext, mockListHistory } = ctx;

  describe("handleKnowledgeHistory", () => {
    it("rejects an invalid status value", async () => {
      const result = await handleKnowledgeHistory({ status: "garbage" }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid status");
      expect(mockListHistory).not.toHaveBeenCalled();
    });

    it("default call (no params) → repo gets undefined filters and limit=0 (repo clamps)", async () => {
      mockListHistory.mockResolvedValueOnce([]);
      await handleKnowledgeHistory({}, makeTestContext());
      expect(mockListHistory).toHaveBeenCalledTimes(1);
      const filters = mockListHistory.mock.calls[0]![0];
      expect(filters.status).toBeUndefined();
      expect(filters.kind).toBeUndefined();
      // Handler passes 0 as a sentinel for "no caller limit" — repo's
      // clampHistoryLimit turns it into the default. Asserts the wiring, not
      // the clamp value (covered by the repo suite).
      expect(filters.limit).toBe(0);
    });

    it("forwards explicit kind/status/limit to the repo", async () => {
      mockListHistory.mockResolvedValueOnce([]);
      await handleKnowledgeHistory(
        { kind: "risk_rule", status: "superseded", limit: 5 },
        makeTestContext(),
      );
      const filters = mockListHistory.mock.calls[0]![0];
      expect(filters).toEqual({ kind: "risk_rule", status: "superseded", limit: 5 });
    });

    it("returns shaped { entries, count, filters } payload", async () => {
      mockListHistory.mockResolvedValueOnce([
        { id: 1, kind: "risk_rule", title: "v1", status: "superseded", supersedesId: null, statusReason: null, changeSummary: null, whatFailed: null, validFrom: "2026-04-01T00:00:00Z", validUntil: null, updatedAt: "2026-04-02T00:00:00Z" },
      ]);
      const result = await handleKnowledgeHistory({ kind: "risk_rule" }, makeTestContext());
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(1);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].id).toBe(1);
      expect(parsed.filters).toEqual({ status: null, kind: "risk_rule" });
    });

    it("does NOT inject anything into loadedDocuments and entries omit contentMd", async () => {
      mockListHistory.mockResolvedValueOnce([
        { id: 1, kind: "risk_rule", title: "v1", status: "superseded", supersedesId: null, statusReason: null, changeSummary: null, whatFailed: null, validFrom: "2026-04-01T00:00:00Z", validUntil: null, updatedAt: "2026-04-02T00:00:00Z" },
      ]);
      const engineCtx = makeTestContext();
      const result = await handleKnowledgeHistory({}, engineCtx);
      expect(engineCtx.loadedDocuments.size).toBe(0);
      const parsed = JSON.parse(result.output);
      expect(parsed.entries[0]).not.toHaveProperty("contentMd");
    });

    it("accepts status='active' as explicit opt-in", async () => {
      mockListHistory.mockResolvedValueOnce([]);
      const result = await handleKnowledgeHistory({ status: "active" }, makeTestContext());
      expect(result.success).toBe(true);
      const filters = mockListHistory.mock.calls[0]![0];
      expect(filters.status).toBe("active");
    });
  });
}
