/**
 * MissionHistory — the Missions ledger view. These tests pin the ETH|USD
 * denomination behaviour (issue #17):
 *   1. USD is the default, and a priced run renders its PnL (and the cumulative
 *      figure) in USD;
 *   2. flipping the toggle to ETH re-denominates in place (persisted uiStore
 *      preference, real store transition);
 *   3. FAIL-SOFT — a run with no captured close price falls back to ETH even
 *      under USD, never a blank or `$NaN`.
 *
 * The two data hooks are mocked; the PnL math itself is covered by
 * missionHistoryModel.test.ts. Here we drive the component off their output.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MissionResultDto } from "@shared/schemas/mission.js";

const useMissionResultsMock = vi.fn();
const usePaperMissionResultsMock = vi.fn();
const useAvailableWalletsMock = vi.fn();
const useSessionsListMock = vi.fn();
const useSimulatorLatestBatchMock = vi.fn();

vi.mock("../../../lib/api/mission.js", () => ({
  useMissionResults: () => useMissionResultsMock(),
  usePaperMissionResults: () => usePaperMissionResultsMock(),
  useSimulatorLatestBatch: () => useSimulatorLatestBatchMock(),
}));
vi.mock("../../../lib/api/wallet-inventory.js", () => ({
  useAvailableWallets: () => useAvailableWalletsMock(),
}));
vi.mock("../../../lib/api/sessions.js", () => ({
  useSessionsList: () => useSessionsListMock(),
}));

const { MissionHistory } = await import("../MissionHistory.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

function result(over: Partial<MissionResultDto> = {}): MissionResultDto {
  const seqNo = over.seqNo ?? 1;
  return {
    missionRunId: `run-${seqNo}`,
    sessionId: `session-${seqNo}`,
    seqNo,
    goalSnippet: "grow ETH",
    startedAt: "2026-07-12T18:00:00.000Z",
    endedAt: "2026-07-12T19:00:00.000Z",
    durationS: 3600,
    bankrollStartEth: 0.01,
    bankrollEndEth: 0.011,
    pnlEth: 0.001,
    pnlPct: 10,
    ethPriceUsdEnd: 3000,
    trades: 2,
    outcome: "completed",
    stopReason: "goal_reached",
    summary: null,
    inferenceProvider: "openrouter",
    inferenceModel: "deepseek/deepseek-v4-flash",
    inferenceFallbackModel: "google/gemini-2.5-flash",
    openPositionsCount: 0,
    simulated: false,
    ...over,
  };
}

function mockResults(results: readonly MissionResultDto[]): void {
  useMissionResultsMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: results },
  });
  usePaperMissionResultsMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: results.filter((row) => row.simulated) },
  });
}

beforeEach(() => {
  useMissionResultsMock.mockReset();
  usePaperMissionResultsMock.mockReset();
  useAvailableWalletsMock.mockReset();
  useSessionsListMock.mockReset();
  useSimulatorLatestBatchMock.mockReset();
  // A primary EVM wallet is present (the view reads evm[0]).
  useAvailableWalletsMock.mockReturnValue({
    data: {
      ok: true,
      data: {
        evm: [{ id: "evm_1", family: "evm", address: "0xAbc", label: "Main", vault: false }],
        solana: [],
      },
    },
  });
  useSessionsListMock.mockReturnValue({
    data: {
      ok: true,
      data: [],
    },
  });
  useSimulatorLatestBatchMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: { batch: null, leaderStrategyId: null, promotedWinnerStrategyId: null, promotedWinnerVersion: null, strategies: [], entries: [], promptVersions: [] } },
  });
  usePaperMissionResultsMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: [] },
  });
  // Reset the persisted denomination to its default before each test.
  useUiStore.setState({ pnlCurrency: "usd", appShellView: "missionHistory" });
});

describe("MissionHistory — PnL denomination", () => {
  it("defaults to USD and renders a priced run's PnL + cumulative in USD", () => {
    mockResults([result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 })]);
    render(<MissionHistory />);

    expect(
      screen.getAllByText(
        /DeepSeek V4 Flash \/ Gemini 2.5 Flash/i,
      ).length,
    ).toBeGreaterThan(0);
    // Column header switches to USD.
    expect(screen.getByText("PnL (USD)")).toBeTruthy();
    // Per-row + cumulative both value 0.001 ETH @ $3000 = +$3.00.
    expect(screen.getAllByText("+$3.00").length).toBeGreaterThanOrEqual(2);
    // No raw ETH figure while USD is active and priced.
    expect(screen.queryByText("+0.0010 ETH")).toBeNull();
  });

  it("re-denominates to ETH when the toggle is flipped (real store transition)", () => {
    mockResults([result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 })]);
    render(<MissionHistory />);

    fireEvent.click(screen.getByRole("radio", { name: "ETH" }));

    expect(useUiStore.getState().pnlCurrency).toBe("eth");
    expect(screen.getByText("PnL (ETH)")).toBeTruthy();
    expect(screen.getAllByText("+0.0010 ETH").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("+$3.00")).toBeNull();
  });

  it("FAILS SOFT to ETH for a run with no close price, even under USD", () => {
    mockResults([result({ pnlEth: 0.001, ethPriceUsdEnd: null })]);
    render(<MissionHistory />);

    // USD is still selected...
    expect(useUiStore.getState().pnlCurrency).toBe("usd");
    // ...but the unpriced row renders ETH with an explanatory hint, never $NaN.
    const cell = screen.getByTitle("No close price recorded — showing ETH");
    expect(within(cell.closest("td") as HTMLElement).getByText("+0.0010 ETH")).toBeTruthy();
    expect(screen.queryByText("$NaN")).toBeNull();
  });

  it("surfaces the stamped primary and fallback model on the mission row", () => {
    mockResults([result()]);
    render(<MissionHistory />);

    expect(
      screen.getByText(
        /model · DeepSeek V4 Flash \/ Gemini 2.5 Flash/i,
      ),
    ).toBeTruthy();
  });
});

describe("MissionHistory — row opens the mission's session", () => {
  it("clicking a row jumps to that mission's session view", () => {
    mockResults([result({ sessionId: "session-42", seqNo: 7 })]);
    render(<MissionHistory />);

    const row = screen.getByRole("button", { name: /Open mission #7/ });
    fireEvent.click(row);

    const state = useUiStore.getState();
    expect(state.activeSessionId).toBe("session-42");
    // Force back to the session view so MissionControls (and its
    // MissionSummaryCard retrospective) mounts, even from the ledger.
    expect(state.appShellView).toBe("session");
  });

  it("pressing Enter on a focused row navigates identically", () => {
    mockResults([result({ sessionId: "session-99", seqNo: 3 })]);
    render(<MissionHistory />);

    const row = screen.getByRole("button", { name: /Open mission #3/ });
    fireEvent.keyDown(row, { key: "Enter" });

    const state = useUiStore.getState();
    expect(state.activeSessionId).toBe("session-99");
    expect(state.appShellView).toBe("session");
  });

  it("pressing Space on a focused row navigates identically", () => {
    mockResults([result({ sessionId: "session-100", seqNo: 4 })]);
    render(<MissionHistory />);

    const row = screen.getByRole("button", { name: /Open mission #4/ });
    fireEvent.keyDown(row, { key: " " });

    const state = useUiStore.getState();
    expect(state.activeSessionId).toBe("session-100");
    expect(state.appShellView).toBe("session");
  });
});

describe("MissionHistory — paper vs live filter", () => {
  it("separates paper missions from live missions", () => {
    mockResults([
      result({ seqNo: 1, simulated: false, goalSnippet: "live mission" }),
      result({ seqNo: 2, simulated: true, goalSnippet: "paper mission" }),
    ]);
    render(<MissionHistory />);

    fireEvent.click(screen.getByRole("radio", { name: "Paper" }));
    expect(screen.getByText("paper mission")).toBeTruthy();
    expect(screen.queryByText("live mission")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Live" }));
    expect(screen.getByText("live mission")).toBeTruthy();
    expect(screen.queryByText("paper mission")).toBeNull();
  });
});

describe("MissionHistory — latest paper batch status", () => {
  it("surfaces latest paper strategy statuses even when no paper results are finalized yet", () => {
    mockResults([]);
    useSessionsListMock.mockReturnValue({
      data: {
        ok: true,
        data: [{ id: "paper-session-1", title: "Paper Mission #44" }],
      },
    });
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: {
            id: "sim-batch-1",
            status: "active",
            goal: "goal",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 1,
            winnerRunId: null,
            winnerScore: null,
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T10:05:00.000Z",
          },
          leaderStrategyId: "falcon",
          promotedWinnerStrategyId: null,
          promotedWinnerVersion: null,
          strategies: [{ id: "falcon", name: "Falcon", shortRule: "Faster entry." }],
          entries: [
            {
              ordinal: 1,
              strategyId: "falcon",
              strategyName: "Falcon",
              shortRule: "Faster entry.",
              sessionId: "paper-session-1",
              missionId: "mission-1",
              missionRunId: "run-1",
              status: "running",
              stopSummary: null,
              inferenceProvider: "openrouter",
              inferenceModel: "deepseek/deepseek-v4-flash",
              inferenceFallbackModel: "google/gemini-2.5-flash",
              score: null,
              pnlEth: null,
              pnlPct: null,
              trades: null,
              outcome: null,
              simulated: true,
            },
          ],
          promptVersions: [],
        },
      },
    });

    render(<MissionHistory />);

    expect(screen.getByText("Latest paper batch")).toBeTruthy();
    expect(screen.getByText("Active paper missions")).toBeTruthy();
    expect(screen.getByText("Paper Mission #44")).toBeTruthy();
    expect(screen.getAllByText("Falcon").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("running").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1/5 complete")).toBeTruthy();
    expect(
      screen.getAllByText(
        /model · DeepSeek V4 Flash \/ Gemini 2.5 Flash/i,
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a batch-wide provider block so dead paper runs do not read as strategy signal", () => {
    mockResults([]);
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: {
            id: "sim-batch-2",
            status: "active",
            goal: "goal",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 0,
            winnerRunId: null,
            winnerScore: null,
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T10:05:00.000Z",
          },
          leaderStrategyId: null,
          promotedWinnerStrategyId: null,
          promotedWinnerVersion: null,
          strategies: [{ id: "falcon", name: "Falcon", shortRule: "Faster entry." }],
          entries: [
            {
              ordinal: 1,
              strategyId: "falcon",
              strategyName: "Falcon",
              shortRule: "Faster entry.",
              sessionId: "paper-session-1",
              missionId: "mission-1",
              missionRunId: "run-1",
              status: "paused_error",
              stopSummary:
                "OpenRouter chat completion failed: status=403 | code=403 | Budget limit exceeded (monthly limit). Contact your org admin.",
              inferenceProvider: "openrouter",
              inferenceModel: "deepseek/deepseek-v4-flash",
              inferenceFallbackModel: "google/gemini-2.5-flash",
              score: null,
              pnlEth: null,
              pnlPct: null,
              trades: null,
              outcome: null,
              simulated: true,
            },
          ],
          promptVersions: [],
        },
      },
    });

    render(<MissionHistory />);

    expect(screen.getByText("Provider blocked")).toBeTruthy();
    expect(
      screen.getByText(/This batch should not be treated as strategy signal\./),
    ).toBeTruthy();
    expect(screen.getByText("provider blocked")).toBeTruthy();
  });
});
