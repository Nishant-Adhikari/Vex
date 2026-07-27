import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MissionResultDto } from "@shared/schemas/mission.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

const useSimulatorLatestBatchMock = vi.fn();
const useSimulatorBatchHistoryMock = vi.fn();
const mutateAsyncMock = vi.fn();
const useSimulatorStartBatchMock = vi.fn();
const useMissionResultsMock = vi.fn();
const usePaperMissionResultsMock = vi.fn();
const useSessionsListMock = vi.fn();

vi.mock("../../../lib/api/mission.js", () => ({
  useSimulatorLatestBatch: () => useSimulatorLatestBatchMock(),
  useSimulatorBatchHistory: () => useSimulatorBatchHistoryMock(),
  useSimulatorStartBatch: () => useSimulatorStartBatchMock(),
  useMissionResults: () => useMissionResultsMock(),
  usePaperMissionResults: () => usePaperMissionResultsMock(),
}));
vi.mock("../../../lib/api/sessions.js", () => ({
  useSessionsList: () => useSessionsListMock(),
}));

const { SimulatorPanel } = await import("../SimulatorPanel.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

function missionResult(over: Partial<MissionResultDto> = {}): MissionResultDto {
  const seqNo = over.seqNo ?? 1;
  return {
    missionRunId: `paper-run-${seqNo}`,
    sessionId: `paper-session-${seqNo}`,
    seqNo,
    goalSnippet: "Paper runner goal",
    startedAt: "2026-07-26T18:00:00.000Z",
    endedAt: "2026-07-26T19:00:00.000Z",
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
    simulated: true,
    ...over,
  };
}

beforeEach(() => {
  useSimulatorLatestBatchMock.mockReset();
  useSimulatorBatchHistoryMock.mockReset();
  mutateAsyncMock.mockReset();
  useSimulatorStartBatchMock.mockReset();
  useMissionResultsMock.mockReset();
  usePaperMissionResultsMock.mockReset();
  useSessionsListMock.mockReset();
  useSimulatorStartBatchMock.mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  });
  useSimulatorBatchHistoryMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: [] },
  });
  useSessionsListMock.mockReturnValue({
    data: {
      ok: true,
      data: [],
    },
  });
  useMissionResultsMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: [] },
  });
  usePaperMissionResultsMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ok: true, data: [] },
  });
  useUiStore.setState({
    appShellView: "simulator",
    activeSessionId: null,
  });
});

describe("SimulatorPanel", () => {
  it("shows prompt-version compare and leader/default badges", () => {
    useSimulatorBatchHistoryMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: [
          {
            id: "batch-1",
            status: "completed",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 5,
            winnerRunId: "run-2",
            winnerScore: 81.2,
            winnerStrategyId: "widow",
            winnerStrategyName: "Widow",
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T12:00:00.000Z",
          },
          {
            id: "batch-0",
            status: "completed",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 5,
            winnerRunId: "run-0",
            winnerScore: 71.5,
            winnerStrategyId: "ironclad",
            winnerStrategyName: "Ironclad",
            createdAt: "2026-07-25T10:00:00.000Z",
            updatedAt: "2026-07-25T12:00:00.000Z",
          },
        ],
      },
    });
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: {
            id: "batch-1",
            status: "completed",
            goal: "goal",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 5,
            winnerRunId: "run-2",
            winnerScore: 81.2,
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T12:00:00.000Z",
          },
          leaderStrategyId: "widow",
          promotedWinnerStrategyId: "widow",
          promotedWinnerVersion: "v1.1",
          strategies: [
            { id: "ironclad", name: "Ironclad", shortRule: "Strict gate." },
            { id: "widow", name: "Widow", shortRule: "Initials out at 2x." },
          ],
          entries: [
            {
              ordinal: 1,
              strategyId: "ironclad",
              strategyName: "Ironclad",
              shortRule: "Strict gate.",
              sessionId: "session-1",
              missionId: "mission-1",
              missionRunId: "run-1",
              status: "completed",
              stopSummary: null,
              inferenceProvider: "openrouter",
              inferenceModel: "deepseek/deepseek-v4-flash",
              inferenceFallbackModel: "google/gemini-2.5-flash",
              score: 70,
              pnlEth: 0.001,
              pnlPct: 10,
              trades: 1,
              outcome: "completed",
              simulated: true,
            },
            {
              ordinal: 2,
              strategyId: "widow",
              strategyName: "Widow",
              shortRule: "Initials out at 2x.",
              sessionId: "session-2",
              missionId: "mission-2",
              missionRunId: "run-2",
              status: "completed",
              stopSummary: null,
              inferenceProvider: "openrouter",
              inferenceModel: "deepseek/deepseek-v4-flash",
              inferenceFallbackModel: "google/gemini-2.5-flash",
              score: 81.2,
              pnlEth: 0.002,
              pnlPct: 20,
              trades: 2,
              outcome: "completed",
              simulated: true,
            },
          ],
          promptVersions: [
            {
              version: "v1.0",
              strategyId: "baseline",
              strategyName: "Current baseline",
              promptText: "GOAL: baseline entry\nFLOW: market cap under $100K",
              sourceBatchId: "baseline",
              promotedAt: "2026-07-26T10:00:00.000Z",
            },
            {
              version: "v1.1",
              strategyId: "widow",
              strategyName: "Widow",
              promptText: "GOAL: recover initials at 2x\nFLOW: market cap under $300K",
              sourceBatchId: "batch-1",
              promotedAt: "2026-07-26T12:00:00.000Z",
            },
          ],
        },
      },
    });

    render(<SimulatorPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Prompts" }));

    expect(screen.getByText("Prompt versions")).toBeTruthy();
    expect(screen.getAllByText(/Live default/i).length).toBeGreaterThan(0);
    expect(screen.getByText("What changed")).toBeTruthy();
    expect(
      screen.getByText(/GOAL: changed from “baseline entry” to “recover initials at 2x”\./i),
    ).toBeTruthy();
    expect(
      screen.getByText(/FLOW: changed from “market cap under \$100K” to “market cap under \$300K”\./i),
    ).toBeTruthy();
    expect(screen.getAllByText(/baseline entry/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/recover initials at 2x/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /DeepSeek V4 Flash \/ Gemini 2.5 Flash/i,
      ).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("radio", { name: "Batch" }));
    expect(screen.getByText("Batch #2")).toBeTruthy();
    expect(screen.getByText("Batch #1")).toBeTruthy();
    expect(
      screen.getAllByText((text) => /^Jul \d{2}, 2026 • \d{2}:\d{2}$/.test(text)).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("manual simulator seeds retain a placeholder allowed wallet so paper runs can launch", async () => {
    const strategiesModule = await import("../../../../shared/simulator/pons-paper-strategies.js");
    const seed = strategiesModule.buildPonsPaperStrategySeed(
      strategiesModule.PONS_PAPER_STRATEGIES[0]!,
      120,
    );

    expect(seed.allowedWallets).toEqual([
      strategiesModule.DEFAULT_SIMULATOR_WALLET_ADDRESS,
    ]);
  });

  it("opens the selected paper mission session from the scorecard table", () => {
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: {
            id: "batch-1",
            status: "active",
            goal: "goal",
            requestedParallel: 5,
            launchedCount: 1,
            completedCount: 0,
            winnerRunId: null,
            winnerScore: null,
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T10:05:00.000Z",
          },
          leaderStrategyId: null,
          promotedWinnerStrategyId: null,
          promotedWinnerVersion: null,
          strategies: [{ id: "ironclad", name: "Ironclad", shortRule: "Strict gate." }],
          entries: [
            {
              ordinal: 1,
              strategyId: "ironclad",
              strategyName: "Ironclad",
              shortRule: "Strict gate.",
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

    render(<SimulatorPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Paper Mission" }));

    const state = useUiStore.getState();
    expect(state.activeSessionId).toBe("paper-session-1");
    expect(state.appShellView).toBe("session");
  });

  it("shows success feedback when a 5-strategy batch launches", async () => {
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: null,
          leaderStrategyId: null,
          promotedWinnerStrategyId: null,
          promotedWinnerVersion: null,
          strategies: [],
          entries: [],
          promptVersions: [],
        },
      },
    });
    mutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { batchId: "batch-2", launched: 5, requested: 5 },
    });

    render(<SimulatorPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Run 5-strategy batch/i }));

    expect(await screen.findByText("Launched 5/5 paper strategies.")).toBeTruthy();
  });

  it("shows explicit failure feedback when zero strategies launch", async () => {
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: null,
          leaderStrategyId: null,
          promotedWinnerStrategyId: null,
          promotedWinnerVersion: null,
          strategies: [],
          entries: [],
          promptVersions: [],
        },
      },
    });
    mutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { batchId: "batch-3", launched: 0, requested: 5 },
    });

    render(<SimulatorPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Run 5-strategy batch/i }));

    expect(
      await screen.findByText(
        "Batch request was accepted, but 0 strategies launched. Check local runtime/database readiness.",
      ),
    ).toBeTruthy();
  });

  it("switches to full paper mission history", () => {
    useSessionsListMock.mockReturnValue({
      data: {
        ok: true,
        data: [{ id: "paper-session-7", title: "Paper Mission #7" }],
      },
    });
    useMissionResultsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: [
          missionResult({
            seqNo: 7,
            sessionId: "paper-session-7",
            goalSnippet: "STRATEGY TAG: widow v1.1",
          }),
          missionResult({
            seqNo: 8,
            simulated: false,
            goalSnippet: "live mission",
          }),
        ],
      },
    });
    useSimulatorBatchHistoryMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: [
          {
            id: "batch-1",
            status: "completed",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 5,
            winnerRunId: "paper-run-7",
            winnerScore: 11,
            winnerStrategyId: "widow",
            winnerStrategyName: "Widow",
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T12:00:00.000Z",
          },
          {
            id: "batch-0",
            status: "completed",
            requestedParallel: 5,
            launchedCount: 5,
            completedCount: 5,
            winnerRunId: "paper-run-1",
            winnerScore: 8,
            winnerStrategyId: "baseline",
            winnerStrategyName: "Current baseline",
            createdAt: "2026-07-25T10:00:00.000Z",
            updatedAt: "2026-07-25T12:00:00.000Z",
          },
        ],
      },
    });
    usePaperMissionResultsMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: [
          missionResult({
            seqNo: 7,
            sessionId: "paper-session-7",
            goalSnippet: "STRATEGY TAG: widow v1.1",
            sourceBatchId: "batch-1",
          }),
        ],
      },
    });
    useSimulatorLatestBatchMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ok: true,
        data: {
          batch: null,
          leaderStrategyId: null,
          promotedWinnerStrategyId: null,
          promotedWinnerVersion: null,
          strategies: [],
          entries: [],
          promptVersions: [],
        },
      },
    });

    render(<SimulatorPanel />);

    fireEvent.click(screen.getByRole("radio", { name: "Paper Missions" }));

    expect(screen.getByText("Paper mission history")).toBeTruthy();
    expect(screen.getByText("Paper Mission #7")).toBeTruthy();
    expect(screen.getByText("Batch #2")).toBeTruthy();
    expect(screen.getByText("widow v1.1")).toBeTruthy();
    expect(screen.queryByText("live mission")).toBeNull();
  });
});
