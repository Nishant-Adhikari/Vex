import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function shortCircuitSuite(ctx: SuiteCtx): void {
  const {
    importKnowledge,
    computeContentHash,
    mockInsertEntry,
    mockFindByContentHash,
    mockEmbedDocument,
    makeManifestLine,
    makeRowLine,
    makeEmbedding,
    lines,
    TEST_DIM,
    TEST_PROVIDER_MODEL,
  } = ctx;

  describe("content_hash recompute + short-circuit", () => {
    it("ignores the file's content_hash and recomputes locally", async () => {
      const row = makeRowLine({ content_hash: "ff".repeat(32) });
      await importKnowledge(lines(makeManifestLine(), row));
      const arg = mockInsertEntry.mock.calls[0]![0];
      const expected = computeContentHash({
        kind: "memo",
        title: "test title",
        summary: "test summary",
        contentMd: "## body\n\ndetail",
      });
      expect(arg.contentHash).toBe(expected);
      expect(arg.contentHash).not.toBe("ff".repeat(32));
    });

    it("stamps embeddingModel from providerModel (response) and embeddingDim from actual length", async () => {
      await importKnowledge(lines(makeManifestLine(), makeRowLine()));
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.embeddingModel).toBe(TEST_PROVIDER_MODEL);
      expect(arg.embeddingDim).toBe(TEST_DIM);
      expect(arg.embedding).toHaveLength(TEST_DIM);
    });

    it("stamps providerModel per-row (different aliases stamp different rows)", async () => {
      mockEmbedDocument
        .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "alias-A" })
        .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "alias-B" });
      await importKnowledge(
        lines(makeManifestLine(), makeRowLine({ title: "row1" }), makeRowLine({ title: "row2" })),
      );
      expect(mockInsertEntry.mock.calls[0]![0].embeddingModel).toBe("alias-A");
      expect(mockInsertEntry.mock.calls[1]![0].embeddingModel).toBe("alias-B");
    });

    it("calls embedDocument with title + summary + config", async () => {
      await importKnowledge(lines(makeManifestLine(), makeRowLine()));
      const [t, s, cfg] = mockEmbedDocument.mock.calls[0]!;
      expect(t).toBe("test title");
      expect(s).toBe("test summary");
      expect(cfg.model).toBe("ai/embeddinggemma:300M-Q8_0");
      expect(cfg.dim).toBe(TEST_DIM);
    });

    it("re-imports a backup without calling the provider when all entries already exist", async () => {
      mockFindByContentHash.mockResolvedValue({
        id: 1,
        kind: "memo",
        title: "x",
        summary: "x",
        contentMd: "x",
        tags: [],
        sourceRefs: {},
        confidence: null,
        status: "active",
        pinned: false,
        validFrom: "2026-04-06T12:00:00Z",
        validUntil: null,
        contentHash: "a".repeat(64),
        embeddingModel: TEST_PROVIDER_MODEL,
        embeddingDim: TEST_DIM,
        createdAt: "2026-04-06T12:00:00Z",
        updatedAt: "2026-04-06T12:00:00Z",
      });
      const report = await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({ title: "row1" }),
          makeRowLine({ title: "row2" }),
          makeRowLine({ title: "row3" }),
        ),
      );
      expect(report.skipped_duplicate).toBe(3);
      expect(report.inserted).toBe(0);
      expect(report.failed).toBe(0);
      expect(mockEmbedDocument).not.toHaveBeenCalled();
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("looks up content_hash BEFORE calling embedDocument (short-circuit ordering)", async () => {
      mockFindByContentHash.mockResolvedValueOnce({ id: 1 } as never);
      await importKnowledge(lines(makeManifestLine(), makeRowLine()));
      expect(mockFindByContentHash).toHaveBeenCalledTimes(1);
      expect(mockEmbedDocument).not.toHaveBeenCalled();
    });
  });
}
