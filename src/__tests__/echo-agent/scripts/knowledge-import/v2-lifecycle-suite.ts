import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function v2LifecycleSuite(ctx: SuiteCtx): void {
  const { importKnowledge, mockInsertEntry, mockFindByContentHash, makeRowLine, lines } = ctx;

  describe("v2 lifecycle roundtrip", () => {
    it("v2: resolves supersedes_content_hash to predecessor id via findByContentHash", async () => {
      const predHash = "b".repeat(64);
      // Successor row arrives second; findByContentHash will be called twice:
      //   1) successor's content_hash (own-row dedup check) → miss (null)
      //   2) predecessor content_hash (lineage resolution) → hit ({ id: 7 })
      mockFindByContentHash
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 7 });
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({
            kind: "risk_rule",
            title: "cap 5%",
            supersedes_content_hash: predHash,
            status_reason: null,
            change_summary: "tightened from 10% to 5%",
            what_failed: "3/24 days hit >7%",
          }),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.supersedesId).toBe(7);
      expect(arg.changeSummary).toBe("tightened from 10% to 5%");
      expect(arg.whatFailed).toBe("3/24 days hit >7%");
    });

    it("v2: unresolved supersedes_content_hash → row fails (does not insert with NULL FK)", async () => {
      // Own-row hash miss (null), predecessor hash also miss (null) → fail.
      mockFindByContentHash
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const report = await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({ supersedes_content_hash: "c".repeat(64) }),
        ),
      );
      expect(report.failed).toBe(1);
      expect(report.inserted).toBe(0);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("v2: non-hex supersedes_content_hash fails validation", async () => {
      const report = await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({ supersedes_content_hash: "not-a-hash" }),
        ),
      );
      expect(report.failed).toBe(1);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("v2: preserves status_reason / change_summary / what_failed through insertEntry", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({
            status: "superseded",
            status_reason: "replaced by tighter rule",
          }),
        ),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.status).toBe("superseded");
      expect(arg.statusReason).toBe("replaced by tighter rule");
      expect(arg.supersedesId).toBeNull();
    });
  });
}
