/**
 * balances repo — per-wallet portfolio snapshot semantics (puzzle 5 phase 5E-1).
 * Mocks the db client to assert SQL + params without a live Postgres.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

let mockQueryOne: Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>>;
let mockQuery: Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>;

function resetMocks() {
  mockQueryOne = vi.fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>>().mockResolvedValue(null);
  mockQuery = vi.fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>().mockResolvedValue([]);
}
resetMocks();

vi.mock("@vex-agent/db/client.js", () => ({
  query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  queryOne: (sql: string, params?: unknown[]) => mockQueryOne(sql, params),
  execute: vi.fn().mockResolvedValue(1),
  getPool: vi.fn(),
}));

const repo = await import("@vex-agent/db/repos/balances.js");

beforeEach(() => {
  resetMocks();
});

const findCall = (calls: unknown[][], needle: string): unknown[] | undefined =>
  calls.find((c) => String(c[0]).includes(needle));

describe("insertSnapshot — per-wallet PnL", () => {
  it("writes wallet dimension + group id and null PnL for a wallet's FIRST snapshot", async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO proj_portfolio_snapshots")) return { id: 42 };
      return null; // getLatestSnapshot — no prior row for this wallet
    });

    const res = await repo.insertSnapshot({
      walletFamily: "eip155",
      walletAddress: "0xA",
      snapshotGroupId: "group-1",
      totalUsd: 1500,
      positions: {},
      activeChains: ["1"],
    });

    expect(res).toEqual({ snapshotId: 42, pnlVsPrev: null });

    // PnL baseline lookup is scoped to THIS wallet (atomic family+address).
    const select = findCall(mockQueryOne.mock.calls, "SELECT * FROM proj_portfolio_snapshots");
    expect(select?.[1]).toEqual(["eip155", "0xA"]);

    // INSERT carries the wallet dimension + group id; pnl params are null.
    const insert = findCall(mockQueryOne.mock.calls, "INSERT INTO proj_portfolio_snapshots");
    const params = insert?.[1] as unknown[];
    expect(params[0]).toBe("eip155"); // wallet_family
    expect(params[1]).toBe("0xA"); // wallet_address
    expect(params[2]).toBe("group-1"); // snapshot_group_id
    expect(params[6]).toBeNull(); // pnl_vs_prev
    expect(params[7]).toBeNull(); // pnl_pct_vs_prev
  });

  it("computes PnL against the SAME wallet's previous snapshot", async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO proj_portfolio_snapshots")) return { id: 43 };
      return { id: 42, wallet_family: "eip155", wallet_address: "0xA", snapshot_group_id: "group-0", total_usd: 1000, positions: {}, active_chains: ["1"], pnl_vs_prev: null, pnl_pct_vs_prev: null, source: "sync", created_at: "2026-05-24T00:00:00.000Z" };
    });

    const res = await repo.insertSnapshot({
      walletFamily: "eip155",
      walletAddress: "0xA",
      snapshotGroupId: "group-1",
      totalUsd: 1500,
      positions: {},
      activeChains: ["1"],
    });

    expect(res.pnlVsPrev).toBe(500);
    const insert = findCall(mockQueryOne.mock.calls, "INSERT INTO proj_portfolio_snapshots");
    expect((insert?.[1] as unknown[])[6]).toBe(500); // pnl_vs_prev
  });
});

describe("getTotalUsd — optional wallet filter", () => {
  it("filters by wallet_address when provided", async () => {
    mockQueryOne.mockResolvedValue({ total: "250" });
    await repo.getTotalUsd("0xA");
    const call = mockQueryOne.mock.calls[0];
    expect(String(call[0])).toContain("WHERE wallet_address = $1");
    expect(call[1]).toEqual(["0xA"]);
  });

  it("sums across all wallets when no address is given", async () => {
    mockQueryOne.mockResolvedValue({ total: "250" });
    await repo.getTotalUsd();
    expect(String(mockQueryOne.mock.calls[0][0])).not.toContain("WHERE wallet_address");
  });
});

describe("getLatestSnapshot / getSnapshotHistory — wallet scoping", () => {
  it("scopes the latest-snapshot query to the wallet filter", async () => {
    mockQueryOne.mockResolvedValue(null);
    await repo.getLatestSnapshot({ walletFamily: "solana", walletAddress: "SoLA" });
    const call = mockQueryOne.mock.calls[0];
    expect(String(call[0])).toContain("wallet_family = $1 AND wallet_address = $2");
    expect(call[1]).toEqual(["solana", "SoLA"]);
  });

  it("scopes history to the wallet filter", async () => {
    mockQuery.mockResolvedValue([]);
    await repo.getSnapshotHistory("7d", { walletFamily: "eip155", walletAddress: "0xA" });
    const call = mockQuery.mock.calls[0];
    expect(String(call[0])).toContain("wallet_family = $1 AND wallet_address = $2");
    expect(call[1]).toEqual(["eip155", "0xA"]);
  });
});
