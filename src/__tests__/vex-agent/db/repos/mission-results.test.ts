/**
 * mission_results repo — open/close lifecycle + history reads (mocked pool).
 *
 * A ledger row is OPENED when a run starts (seq_no minted per wallet) and CLOSED
 * when the run finalizes. Pins the SQL shape + params: per-wallet seq numbering,
 * idempotent open, close-by-run_id, and newest-first history reads.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

type QMock = Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>;
type EMock = Mock<(sql: string, params?: unknown[]) => Promise<number>>;

let mockQuery: QMock;
let mockQueryOne: Mock;
let mockExecute: EMock;

vi.mock("@vex-agent/db/client.js", () => ({
  query: (sql: string, p?: unknown[]) => mockQuery(sql, p),
  queryOne: (sql: string, p?: unknown[]) => mockQueryOne(sql, p),
  execute: (sql: string, p?: unknown[]) => mockExecute(sql, p),
  queryWith: vi.fn(),
  queryOneWith: vi.fn(),
  executeWith: vi.fn(),
}));

const repo = await import("@vex-agent/db/repos/mission-results.js");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

beforeEach(() => {
  mockQuery = vi.fn(async () => []);
  mockQueryOne = vi.fn(async () => null);
  mockExecute = vi.fn(async () => 1);
});

const OPEN = {
  id: "res-1",
  missionId: "mission-1",
  missionRunId: "run-1",
  sessionId: "00000000-0000-4000-8000-000000000001",
  walletAddress: "0xAbC",
  chainId: 4663,
  goalSnippet: "grow ETH +8%",
  bankrollStartEth: 0.012,
  ethPriceUsdStart: 3000,
};

describe("openMissionResult", () => {
  it("inserts with a per-wallet seq_no minted from the row count", async () => {
    await repo.openMissionResult(OPEN);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0]!;
    const s = norm(sql);
    expect(s).toContain("INSERT INTO mission_results");
    // seq_no = count+1 for THIS wallet (case-insensitive)
    expect(s).toContain("SELECT COUNT(*)+1 FROM mission_results WHERE LOWER(wallet_address) = LOWER(");
    expect(s).toContain("outcome");
    expect(params).toContain("run-1");
    expect(params).toContain("0xAbC");
  });

  it("is idempotent — a duplicate open for the same run does nothing", async () => {
    await repo.openMissionResult(OPEN);
    const s = norm(mockExecute.mock.calls[0]![0]);
    expect(s).toContain("ON CONFLICT (mission_run_id) DO NOTHING");
  });
});

describe("closeMissionResult", () => {
  it("updates the row by run_id with terminal outcome, PNL, counts, and duration", async () => {
    await repo.closeMissionResult({
      missionRunId: "run-1",
      outcome: "completed",
      bankrollEndEth: 0.013,
      ethPriceUsdEnd: 3100,
      pnlEth: 0.001,
      pnlPct: 8.33,
      trades: 4,
      wins: 3,
      losses: 1,
      rotations: 1,
      vetoes: 2,
      openPositions: [{ token: "NOXA", amount: "10" }],
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0]!;
    const s = norm(sql);
    expect(s).toContain("UPDATE mission_results SET");
    expect(s).toContain("WHERE mission_run_id =");
    expect(s).toContain("ended_at = NOW()");
    expect(s.toLowerCase()).toContain("duration_s");
    expect(params).toContain("run-1");
    expect(params).toContain("completed");
    // open_positions serialized as jsonb text, not a raw object
    expect(params!.some((p) => typeof p === "string" && p.includes("NOXA"))).toBe(true);
  });
});

describe("history reads", () => {
  it("listResultsForWallet reads newest-first for the wallet (case-insensitive)", async () => {
    await repo.listResultsForWallet("0xAbC", 25);
    const [sql, params] = mockQuery.mock.calls[0]!;
    const s = norm(sql);
    expect(s).toContain("FROM mission_results");
    expect(s).toContain("LOWER(wallet_address) = LOWER(");
    expect(s).toContain("ORDER BY seq_no DESC");
    expect(params).toEqual(["0xAbC", 25]);
  });

  it("getResultForRun reads a single row by run_id", async () => {
    await repo.getResultForRun("run-1");
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(norm(sql)).toContain("WHERE mission_run_id =");
    expect(params).toEqual(["run-1"]);
  });
});
