import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

/**
 * Build a fixture lineage row for the recursive-CTE result set. Mirrors the
 * column list selected by `getLineageChain`'s SQL — no embedding / content_md
 * because lineage browse is metadata-only.
 */
function lineageRow(overrides: {
  id: number;
  status?: string;
  supersedesId?: number | null;
  statusReason?: string | null;
  changeSummary?: string | null;
  whatFailed?: string | null;
  pos: number;
  kind?: string;
  title?: string;
}) {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "risk_rule",
    title: overrides.title ?? `v${overrides.id}`,
    status: overrides.status ?? "active",
    supersedes_id: overrides.supersedesId ?? null,
    status_reason: overrides.statusReason ?? null,
    change_summary: overrides.changeSummary ?? null,
    what_failed: overrides.whatFailed ?? null,
    valid_from: "2026-04-01T00:00:00Z",
    valid_until: null,
    updated_at: "2026-04-10T00:00:00Z",
    pos: overrides.pos,
  };
}

export function lineageSuite(ctx: SuiteCtx): void {
  const { getLineageChain, mockQuery } = ctx;

  describe("getLineageChain", () => {
    it("returns null on invalid id without hitting DB", async () => {
      expect(await getLineageChain(0)).toBeNull();
      expect(await getLineageChain(-1)).toBeNull();
      expect(await getLineageChain(NaN)).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("returns null when no rows match", async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getLineageChain(42)).toBeNull();
    });

    it("issues a single recursive-CTE round-trip with the requested id and recursion limit", async () => {
      mockQuery.mockResolvedValueOnce([lineageRow({ id: 5, pos: 0 })]);
      await getLineageChain(5);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("WITH RECURSIVE");
      expect(sql).toContain("down");
      expect(sql).toContain("up");
      expect(sql).toContain("ORDER BY pos ASC");
      expect(params).toEqual([5, 100]); // requested id, MAX_LINEAGE_HOPS
    });

    it("single-node chain: head equals requested, headStatus mirrors entry status", async () => {
      mockQuery.mockResolvedValueOnce([lineageRow({ id: 5, pos: 0, status: "active" })]);
      const result = await getLineageChain(5);
      expect(result).not.toBeNull();
      expect(result!.requestedId).toBe(5);
      expect(result!.headId).toBe(5);
      expect(result!.headStatus).toBe("active");
      expect(result!.chain).toHaveLength(1);
      expect(result!.chain[0]!.id).toBe(5);
    });

    it("multi-step chain A→B→C, queried from middle B, returns root→head order with correct headId", async () => {
      // Mock returns rows pre-sorted by `pos ASC` (root first, head last).
      // For chain A(1) → B(2) → C(3) queried from B: down hop=1 → A (pos=-1),
      // up hop=0 → B (pos=0), up hop=1 → C (pos=1).
      mockQuery.mockResolvedValueOnce([
        lineageRow({ id: 1, pos: -1, status: "superseded", supersedesId: null }),
        lineageRow({ id: 2, pos: 0, status: "superseded", supersedesId: 1 }),
        lineageRow({ id: 3, pos: 1, status: "active", supersedesId: 2 }),
      ]);
      const result = await getLineageChain(2);
      expect(result!.requestedId).toBe(2);
      expect(result!.chain.map(c => c.id)).toEqual([1, 2, 3]);
      expect(result!.headId).toBe(3);
      expect(result!.headStatus).toBe("active");
    });

    it("chain with terminated head reports headStatus accordingly", async () => {
      mockQuery.mockResolvedValueOnce([
        lineageRow({ id: 1, pos: 0, status: "superseded", supersedesId: null }),
        lineageRow({ id: 2, pos: 1, status: "invalidated", supersedesId: 1 }),
      ]);
      const result = await getLineageChain(1);
      expect(result!.headId).toBe(2);
      expect(result!.headStatus).toBe("invalidated");
    });

    it("query starting at head still returns the full chain", async () => {
      // Chain A→B→C queried from C: down hop=1 → B (pos=-1), down hop=2 → A (pos=-2),
      // up hop=0 → C (pos=0). DB sorts these as: A(pos=-2), B(pos=-1), C(pos=0).
      mockQuery.mockResolvedValueOnce([
        lineageRow({ id: 1, pos: -2, status: "superseded", supersedesId: null }),
        lineageRow({ id: 2, pos: -1, status: "superseded", supersedesId: 1 }),
        lineageRow({ id: 3, pos: 0, status: "active", supersedesId: 2 }),
      ]);
      const result = await getLineageChain(3);
      expect(result!.chain.map(c => c.id)).toEqual([1, 2, 3]);
      expect(result!.headId).toBe(3);
    });

    it("propagates supersedesId/statusReason/changeSummary/whatFailed metadata through to chain items", async () => {
      mockQuery.mockResolvedValueOnce([
        lineageRow({
          id: 1, pos: 0, status: "superseded",
          statusReason: "tightened threshold",
        }),
        lineageRow({
          id: 2, pos: 1, status: "active",
          supersedesId: 1,
          changeSummary: "5% drawdown limit",
          whatFailed: "10% triggered too rarely",
        }),
      ]);
      const result = await getLineageChain(1);
      expect(result!.chain[0]!.statusReason).toBe("tightened threshold");
      expect(result!.chain[1]!.changeSummary).toBe("5% drawdown limit");
      expect(result!.chain[1]!.whatFailed).toBe("10% triggered too rarely");
      expect(result!.chain[1]!.supersedesId).toBe(1);
    });
  });

}
