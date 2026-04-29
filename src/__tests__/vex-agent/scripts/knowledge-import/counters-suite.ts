import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function countersSuite(ctx: SuiteCtx): void {
  const { importKnowledge, mockInsertEntry, mockEmbedDocument, makeManifestLine, makeRowLine, lines } = ctx;

  describe("report counters", () => {
    it("counts duplicates (insertEntry returning inserted=false)", async () => {
      mockInsertEntry
        .mockResolvedValueOnce({ entry: { id: 1 }, inserted: true })
        .mockResolvedValueOnce({ entry: { id: 2 }, inserted: false });
      const report = await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({ title: "first" }),
          makeRowLine({ title: "second" }),
        ),
      );
      expect(report.inserted).toBe(1);
      expect(report.skipped_duplicate).toBe(1);
      expect(report.failed).toBe(0);
      expect(report.total).toBe(2);
    });

    it("continues on per-row failure and counts it as failed", async () => {
      mockInsertEntry
        .mockResolvedValueOnce({ entry: { id: 1 }, inserted: true })
        .mockRejectedValueOnce(new Error("insert boom"))
        .mockResolvedValueOnce({ entry: { id: 3 }, inserted: true });
      const report = await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({ title: "ok 1" }),
          makeRowLine({ title: "boom" }),
          makeRowLine({ title: "ok 3" }),
        ),
      );
      expect(report.inserted).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.skipped_duplicate).toBe(0);
      expect(report.total).toBe(3);
    });

    it("rejects rows missing required text fields without calling embed/insert", async () => {
      const report = await importKnowledge(
        lines(
          makeManifestLine(),
          JSON.stringify({ kind: "memo" }), // missing title/summary/content_md
        ),
      );
      expect(report.failed).toBe(1);
      expect(report.inserted).toBe(0);
      expect(mockEmbedDocument).not.toHaveBeenCalled();
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("skips blank lines without counting them", async () => {
      const report = await importKnowledge(
        lines(makeManifestLine(), "", makeRowLine(), "   "),
      );
      expect(report.total).toBe(1);
      expect(report.inserted).toBe(1);
    });
  });
}
