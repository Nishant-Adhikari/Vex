/**
 * Mission results ledger handler tests (WP-J) — `listResults` (PER-WALLET)
 * and `getResultForRun`. Both are read-only projections of the engine's
 * `mission_results` ledger; no wallet-address logging anywhere in this path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { CH } from "@shared/ipc/channels.js";
import {
  createTestWebContents,
  createTrustedSender,
} from "../test-sender.js";

const mockListResultsForWallet = vi.fn();
const mockGetResultForRun = vi.fn();
const mockGetSessionResult = vi.fn();
const mockEnsureEngineDbUrl = vi.fn();
const mockGetMission = vi.fn();
const mockCountSimTradesForRun = vi.fn();
const mockListSimPositionsForRun = vi.fn();
const mockSumRealizedPnlForRun = vi.fn();

vi.mock("electron", () => {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, p: unknown) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          fn: (e: IpcMainInvokeEvent, p: unknown) => unknown,
        ) => handlers.set(channel, fn),
      ),
      removeHandler: vi.fn((ch: string) => handlers.delete(ch)),
    },
    __handlers: handlers,
  };
});

vi.mock("@vex-agent/db/repos/mission-results.js", () => ({
  listResultsForWallet: (...a: unknown[]) => mockListResultsForWallet(...a),
  getResultForRun: (...a: unknown[]) => mockGetResultForRun(...a),
  getSessionResult: (...a: unknown[]) => mockGetSessionResult(...a),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
}));

vi.mock("@vex-agent/db/repos/sim-ledger.js", () => ({
  countSimTradesForRun: (...a: unknown[]) => mockCountSimTradesForRun(...a),
  listSimPositionsForRun: (...a: unknown[]) => mockListSimPositionsForRun(...a),
  sumRealizedPnlForRun: (...a: unknown[]) => mockSumRealizedPnlForRun(...a),
}));

vi.mock("../../runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: (...a: unknown[]) => mockEnsureEngineDbUrl(...a),
}));

vi.mock("../../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerMissionHandlers } = await import("../../mission.js");
const electronMock = (await import("electron")) as unknown as {
  __handlers: Map<string, (e: IpcMainInvokeEvent, p: unknown) => unknown>;
};

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

async function call(channel: string, payload: unknown) {
  const handler = electronMock.__handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return (await handler(
    trustedSender as unknown as IpcMainInvokeEvent,
    {
      requestId: "11111111-1111-4111-8111-111111111111",
      payload,
    },
  )) as { ok: boolean; data?: unknown; error?: { code: string } };
}

const LEDGER_ROW = {
  missionRunId: "run-1",
  missionId: "mission-1",
  sessionId: "session-1",
  walletAddress: "0xAbC",
  chainId: 4663,
  seqNo: 1,
  goalSnippet: "grow ETH",
  startedAt: "2026-07-12T18:00:00.000Z",
  endedAt: "2026-07-12T19:00:00.000Z",
  durationS: 3600,
  bankrollStartEth: 0.01,
  bankrollEndEth: 0.011,
  pnlEth: 0.001,
  pnlPct: 10,
  ethPriceUsdStart: 3000,
  ethPriceUsdEnd: 3100,
  trades: 2,
  outcome: "completed" as const,
  stopReason: "goal_reached",
  summary: "Goal reached: bankroll +10%.",
  openPositions: [{ symbol: "NOXA" }],
};

const SIM_LEDGER_ROW = {
  ...LEDGER_ROW,
  missionRunId: "sim-run-1",
  missionId: "mission-sim-1",
  sessionId: "session-sim-1",
  simulated: true,
  bankrollStartEth: null,
  bankrollEndEth: null,
  pnlEth: null,
  pnlPct: null,
  trades: 0,
  ethPriceUsdStart: 2500,
  summary: "Paper run ended.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureEngineDbUrl.mockResolvedValue({ ok: true, data: undefined });
  mockGetMission.mockResolvedValue(null);
  mockCountSimTradesForRun.mockResolvedValue(0);
  mockListSimPositionsForRun.mockResolvedValue([]);
  mockSumRealizedPnlForRun.mockResolvedValue(0);
  electronMock.__handlers.clear();
  registerMissionHandlers();
});

describe("mission.listResults", () => {
  it("reads history for the given wallet only (PER-WALLET, never all wallets)", async () => {
    mockListResultsForWallet.mockResolvedValueOnce([LEDGER_ROW]);
    const result = await call(CH.mission.listResults, { walletAddress: "0xAbC" });

    expect(result.ok).toBe(true);
    expect(mockListResultsForWallet).toHaveBeenCalledWith("0xAbC", 50);
    const data = result.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      missionRunId: "run-1",
      seqNo: 1,
      outcome: "completed",
      stopReason: "goal_reached",
      summary: "Goal reached: bankroll +10%.",
      openPositionsCount: 1,
    });
    // The DTO never echoes the wallet address or raw open-position payload.
    expect(data[0]).not.toHaveProperty("walletAddress");
    expect(data[0]).not.toHaveProperty("openPositions");
  });

  it("honors an explicit limit", async () => {
    mockListResultsForWallet.mockResolvedValueOnce([]);
    await call(CH.mission.listResults, { walletAddress: "0xAbC", limit: 10 });
    expect(mockListResultsForWallet).toHaveBeenCalledWith("0xAbC", 10);
  });

  it("maps a db-unavailable ensureEngineDbUrl failure straight through", async () => {
    mockEnsureEngineDbUrl.mockResolvedValueOnce({
      ok: false,
      error: { code: "internal.unexpected", domain: "runtime", message: "db down", retryable: true, userActionable: true, redacted: true, correlationId: "x" },
    });
    const result = await call(CH.mission.listResults, { walletAddress: "0xAbC" });
    expect(result.ok).toBe(false);
    expect(mockListResultsForWallet).not.toHaveBeenCalled();
  });

  it("maps a repo throw to a controlFailedError, never a crash", async () => {
    mockListResultsForWallet.mockRejectedValueOnce(new Error("db exploded"));
    const result = await call(CH.mission.listResults, { walletAddress: "0xAbC" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("internal.unexpected");
  });
});

describe("mission.getResultForRun", () => {
  it("returns the mapped DTO for a known run", async () => {
    mockGetResultForRun.mockResolvedValueOnce(LEDGER_ROW);
    const result = await call(CH.mission.getResultForRun, { missionRunId: "run-1", walletAddress: "0xAbC" });
    expect(result.ok).toBe(true);
    expect(mockGetResultForRun).toHaveBeenCalledWith("run-1", "0xAbC");
    expect(result.data).toMatchObject({ missionRunId: "run-1", outcome: "completed" });
  });

  it("returns null when the run was never opened", async () => {
    mockGetResultForRun.mockResolvedValueOnce(null);
    const result = await call(CH.mission.getResultForRun, { missionRunId: "run-x", walletAddress: "0xAbC" });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it("repairs simulator PnL for a known paper run", async () => {
    mockGetResultForRun.mockResolvedValueOnce(SIM_LEDGER_ROW);
    mockGetMission.mockResolvedValueOnce({
      id: "mission-sim-1",
      capitalSourceJson: { amount: "$20 (paper)" },
    });
    mockCountSimTradesForRun.mockResolvedValueOnce(2);
    mockListSimPositionsForRun.mockResolvedValueOnce([]);
    mockSumRealizedPnlForRun.mockResolvedValueOnce(0.002);

    const result = await call(CH.mission.getResultForRun, {
      missionRunId: "sim-run-1",
      walletAddress: "0xAbC",
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      missionRunId: "sim-run-1",
      trades: 2,
      bankrollStartEth: 0.008,
      bankrollEndEth: 0.01,
      pnlEth: 0.002,
      pnlPct: 25,
    });
  });
});

describe("mission.getSessionResult", () => {
  it("repairs simulator PnL for the latest paper result in a session", async () => {
    mockGetSessionResult.mockResolvedValueOnce(SIM_LEDGER_ROW);
    mockGetMission.mockResolvedValueOnce({
      id: "mission-sim-1",
      capitalSourceJson: { amount: "$20 (paper)" },
    });
    mockCountSimTradesForRun.mockResolvedValueOnce(1);
    mockListSimPositionsForRun.mockResolvedValueOnce([]);
    mockSumRealizedPnlForRun.mockResolvedValueOnce(-0.001);

    const result = await call(CH.mission.getSessionResult, {
      sessionId: "session-sim-1",
    });

    expect(result.ok).toBe(true);
    expect(mockGetSessionResult).toHaveBeenCalledWith("session-sim-1");
    expect(result.data).toMatchObject({
      missionRunId: "sim-run-1",
      trades: 1,
      bankrollStartEth: 0.008,
      bankrollEndEth: 0.007,
      pnlEth: -0.001,
      pnlPct: -12.5,
    });
  });
});
