/**
 * transactions repo — Stage 9 unit tests (mocked pool).
 *
 * Pins the SQL shape + params and the keyset/union/exposure invariants:
 *   - sessionId missing → successes only (failure half omitted, NOT leaked)
 *   - productType filters product_type (success) / derived-product allowlist
 *     (failure), NOT trade_side
 *   - txHash filters BOTH halves
 *   - the SQL NEVER selects params / result / trade_capture
 *   - keyset predicate present on each half; hasMore via limit+1; nextCursor
 *     minted from the last KEPT row's microsecond cursor_ts
 *   - tie ordering stable across success/failure (source_rank tie-break) — the
 *     ORDER BY carries source_rank between created_at and id
 *   - returned rows carry no params/result; failure rows carry no economics
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

type QueryMock = Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>;

let mockQuery: QueryMock;

function resetMocks() {
  mockQuery = vi
    .fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValue([]);
}
resetMocks();

vi.mock("@vex-agent/db/client.js", () => ({
  query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  queryOne: vi.fn(),
  execute: vi.fn(),
  queryWith: vi.fn(),
  queryOneWith: vi.fn(),
  executeWith: vi.fn(),
}));

const repo = await import("@vex-agent/db/repos/transactions.js");
const { encodeCursor } = await import("@vex-agent/db/repos/transactions-cursor.js");
const { failureToolsForProduct } = await import("@vex-agent/db/repos/transactions-failure-tools.js");

const ADDRS = ["0xEVM", "SOL"];
const SESSION = "00000000-0000-4000-8000-000000000001";

function lastSql(): string {
  return mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![0];
}
function lastParams(): unknown[] {
  return mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![1] ?? [];
}

beforeEach(() => {
  resetMocks();
});

// ── data-exposure invariant ───────────────────────────────────────────────

describe("data-exposure invariant", () => {
  it("NEVER selects params, result, or trade_capture", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 20 });
    const sql = lastSql();
    // Word-boundary checks so e.g. a hypothetical column containing "result"
    // would still trip — but plainly, none of these tokens should appear.
    expect(sql).not.toMatch(/\bparams\b/);
    expect(sql).not.toMatch(/\bresult\b/);
    expect(sql).not.toMatch(/\btrade_capture\b/);
  });

  it("failure rows on the output carry no economics and no params/result field", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        source: "failure", source_rank: 1, id: 7, namespace: "solana",
        product_type: null, trade_side: null, chain: null,
        input_token: null, input_amount: null, output_token: null, output_amount: null,
        value_usd: null, capture_status: null, status: "failed",
        tool_id: "solana.swap.execute", duration_ms: 1200,
        tx_hash: null, created_at: "2026-06-04T10:00:00.000000Z",
        cursor_ts: "2026-06-04T10:00:00.000000Z",
      },
    ]);
    const res = await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 20 });
    const row = res.items[0]! as Record<string, unknown>;
    expect(row.source).toBe("failure");
    expect(row.productType).toBe("spot"); // derived from the allowlist
    expect(row.status).toBe("failed");
    expect(row.toolId).toBe("solana.swap.execute");
    expect("params" in row).toBe(false);
    expect("result" in row).toBe(false);
    // No economics fields on a failure row.
    for (const econ of ["valueUsd", "inputToken", "outputToken", "tradeSide", "captureStatus"]) {
      expect(row[econ]).toBeUndefined();
    }
  });
});

// ── session scoping ────────────────────────────────────────────────────────

describe("session scoping", () => {
  it("sessionId present → emits BOTH halves (UNION ALL)", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 20 });
    const sql = lastSql();
    expect(sql).toContain("FROM proj_activity");
    expect(sql).toContain("FROM protocol_executions");
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("success = false");
    expect(lastParams()).toContain(SESSION);
  });

  it("sessionId null → SUCCESS half only (failure half omitted, not leaked)", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: null, limit: 20 });
    const sql = lastSql();
    expect(sql).toContain("FROM proj_activity");
    expect(sql).not.toContain("FROM protocol_executions");
    expect(sql).not.toContain("UNION ALL");
    expect(sql).not.toContain("success = false");
  });

  it("sessionId empty string → SUCCESS half only", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: "", limit: 20 });
    expect(lastSql()).not.toContain("FROM protocol_executions");
  });

  it("empty wallet set → no query, empty result (fail-closed)", async () => {
    const res = await repo.getTransactions({ addresses: [], sessionId: SESSION, limit: 20 });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.items).toEqual([]);
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
    expect(res.failuresScope).toBe("session");
  });
});

// ── filters ────────────────────────────────────────────────────────────────

describe("filters", () => {
  it("productType filters product_type (success) + the failure-tool allowlist (NOT trade_side)", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, productType: "spot", limit: 20 });
    const sql = lastSql();
    const params = lastParams();
    // Success half filters product_type.
    expect(sql).toContain("product_type = $");
    expect(params).toContain("spot");
    // Failure half filters by the DERIVED-PRODUCT allowlist, never trade_side.
    expect(sql).not.toMatch(/trade_side\s*=/);
    const spotTools = failureToolsForProduct("spot");
    const hasAllowlistParam = params.some(
      (p) => Array.isArray(p) && p.length === spotTools.length && spotTools.every((t) => p.includes(t)),
    );
    expect(hasAllowlistParam, "spot failure-tool allowlist bound as a param").toBe(true);
  });

  it("txHash filters BOTH halves", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, txHash: "0xDEAD", limit: 20 });
    const sql = lastSql();
    // external_refs->>'txHash' must appear in BOTH the success and failure WHERE.
    const occurrences = sql.split("external_refs->>'txHash' = $").length - 1;
    expect(occurrences).toBe(2);
    expect(lastParams().filter((p) => p === "0xDEAD")).toHaveLength(2);
  });

  it("namespace filters BOTH halves", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, namespace: "solana", limit: 20 });
    const sql = lastSql();
    expect(sql.split("namespace = $").length - 1).toBe(2);
  });
});

// ── ordering + keyset pagination ─────────────────────────────────────────────

describe("ordering + keyset", () => {
  it("ORDER BY carries source_rank between created_at and id (stable cross-source tie-break)", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 20 });
    expect(lastSql()).toContain("ORDER BY created_at DESC, source_rank DESC, id DESC");
  });

  it("first page (no cursor) emits NO keyset predicate and LIMIT limit+1", async () => {
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 20 });
    const sql = lastSql();
    expect(sql).not.toContain("::timestamptz");
    // limit+1 bound as the last param.
    const params = lastParams();
    expect(params[params.length - 1]).toBe(21);
  });

  it("with a cursor, each half carries the strict-past keyset predicate", async () => {
    const cursor = { cursorTs: "2026-06-04T10:00:00.500000Z", sourceRank: 1 as const, id: 99 };
    await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, cursor, limit: 20 });
    const sql = lastSql();
    // Strict-past tuple comparison present (specialised per half with constant rank).
    expect(sql).toContain("created_at < $1::timestamptz");
    // Both halves reference the keyset (success rank 0, failure rank 1).
    expect(sql).toContain("0 < $2::int");
    expect(sql).toContain("1 < $2::int");
    expect(sql).toContain("id < $3::int");
    const params = lastParams();
    expect(params[0]).toBe("2026-06-04T10:00:00.500000Z");
    expect(params[1]).toBe(1);
    expect(params[2]).toBe(99);
  });

  it("hasMore=false when rows ≤ limit; nextCursor null", async () => {
    mockQuery.mockResolvedValueOnce([row({ id: 1 }), row({ id: 2 })]);
    const res = await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 5 });
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
    expect(res.items).toHaveLength(2);
  });

  it("hasMore=true via limit+1; nextCursor minted from the LAST KEPT row", async () => {
    // limit 2 → fetch 3; the 3rd is the +1 sentinel and is dropped.
    mockQuery.mockResolvedValueOnce([
      row({ id: 10, source_rank: 0, cursor_ts: "2026-06-04T10:00:02.000000Z" }),
      row({ id: 9, source_rank: 0, cursor_ts: "2026-06-04T10:00:01.000000Z" }),
      row({ id: 8, source_rank: 0, cursor_ts: "2026-06-04T10:00:00.000000Z" }), // +1 sentinel
    ]);
    const res = await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 2 });
    expect(res.hasMore).toBe(true);
    expect(res.items).toHaveLength(2);
    // nextCursor encodes the LAST KEPT row (id 9, ts ...01), NOT the sentinel.
    expect(res.nextCursor).toBe(
      encodeCursor({ cursorTs: "2026-06-04T10:00:01.000000Z", sourceRank: 0, id: 9 }),
    );
  });

  it("tie ordering: a success (rank 0) and failure (rank 1) at equal created_at keep a stable cursor", async () => {
    mockQuery.mockResolvedValueOnce([
      row({ id: 5, source: "failure", source_rank: 1, tool_id: "solana.swap.execute", cursor_ts: "2026-06-04T10:00:00.000000Z" }),
      row({ id: 5, source: "success", source_rank: 0, cursor_ts: "2026-06-04T10:00:00.000000Z" }),
      row({ id: 4, source: "success", source_rank: 0, cursor_ts: "2026-06-04T10:00:00.000000Z" }), // sentinel
    ]);
    const res = await repo.getTransactions({ addresses: ADDRS, sessionId: SESSION, limit: 2 });
    expect(res.hasMore).toBe(true);
    // last kept row is the success rank-0 id-5 (the equal-created_at tie-break landed it after the failure).
    expect(res.nextCursor).toBe(
      encodeCursor({ cursorTs: "2026-06-04T10:00:00.000000Z", sourceRank: 0, id: 5 }),
    );
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    source: "success", source_rank: 0, id: 1, namespace: "solana",
    product_type: "spot", trade_side: "buy", chain: "solana",
    input_token: "USDC", input_amount: "10", output_token: "BONK", output_amount: "1000",
    value_usd: "10.5", capture_status: "executed", status: null,
    tool_id: null, duration_ms: null,
    tx_hash: "0xabc", created_at: "2026-06-04T10:00:00.000000Z",
    cursor_ts: "2026-06-04T10:00:00.000000Z",
    ...overrides,
  };
}
