import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function auditSuite(ctx: SuiteCtx): void {
  const { importKnowledge, mockInsertEntry, makeManifestLine, makeRowLine, lines } = ctx;

  describe("audit roundtrip", () => {
    it("preserves status='invalidated' from the export (does NOT overwrite with 'active')", async () => {
      await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({ status: "invalidated", valid_until: "2025-01-01T00:00:00Z" }),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.status).toBe("invalidated");
    });

    it("preserves valid_from / created_at / updated_at exactly", async () => {
      const validFrom = "2025-01-01T00:00:00Z";
      const createdAt = "2025-01-01T00:00:00Z";
      const updatedAt = "2025-06-01T00:00:00Z";
      await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({
            valid_from: validFrom,
            created_at: createdAt,
            updated_at: updatedAt,
          }),
        ),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.validFrom).toBeInstanceOf(Date);
      // toISOString() emits the full millisecond form; compare on epoch ms.
      expect(arg.validFrom!.getTime()).toBe(new Date(validFrom).getTime());
      expect(arg.createdAt!.getTime()).toBe(new Date(createdAt).getTime());
      expect(arg.updatedAt!.getTime()).toBe(new Date(updatedAt).getTime());
    });

    it("preserves pinned=true through the roundtrip", async () => {
      await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ pinned: true, valid_until: null })),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.pinned).toBe(true);
      expect(arg.validUntil).toBeNull();
    });
  });

  describe("audit fail-loud on broken fields", () => {
    it("fails the row when status is present but not a valid KnowledgeStatus (no silent 'active')", async () => {
      const report = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ status: "garbage" })),
      );
      expect(report.failed).toBe(1);
      expect(report.inserted).toBe(0);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("fails the row when status is present but wrong type (number)", async () => {
      const report = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ status: 42 })),
      );
      expect(report.failed).toBe(1);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("fails the row when valid_from is present but unparseable (no silent NOW())", async () => {
      const report = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ valid_from: "not-a-date" })),
      );
      expect(report.failed).toBe(1);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("fails the row when valid_until is present but unparseable (no silent null)", async () => {
      const report = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ valid_until: "garbage" })),
      );
      expect(report.failed).toBe(1);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("fails the row when created_at or updated_at is unparseable", async () => {
      const reportA = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ created_at: "junk" })),
      );
      expect(reportA.failed).toBe(1);

      const reportB = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ updated_at: "junk" })),
      );
      expect(reportB.failed).toBe(1);
    });

    it("treats null valid_until as evergreen (NOT as broken)", async () => {
      const report = await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ valid_until: null })),
      );
      expect(report.inserted).toBe(1);
      expect(report.failed).toBe(0);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.validUntil).toBeNull();
    });

    it("treats missing audit fields (undefined) as defaults — not as broken", async () => {
      // Manually craft a row without status / valid_from / created_at / updated_at
      const rawRow = JSON.stringify({
        kind: "memo",
        title: "minimal",
        summary: "minimal",
        content_md: "minimal",
        valid_until: null,
        content_hash: "f".repeat(64),
      });
      const report = await importKnowledge(lines(makeManifestLine(), rawRow));
      expect(report.inserted).toBe(1);
      expect(report.failed).toBe(0);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.status).toBeUndefined();
      expect(arg.validFrom).toBeUndefined();
      expect(arg.createdAt).toBeUndefined();
      expect(arg.updatedAt).toBeUndefined();
    });

    it("continues to next row after a fail-loud broken-field row", async () => {
      const report = await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({ title: "ok 1" }),
          makeRowLine({ title: "broken", status: "garbage" }),
          makeRowLine({ title: "ok 3" }),
        ),
      );
      expect(report.inserted).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.total).toBe(3);
    });
  });
}
