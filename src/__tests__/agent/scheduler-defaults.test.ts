import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListTasks = vi.fn(async () => []);
const mockGetEnabledTasks = vi.fn(async () => []);
const mockCreateTask = vi.fn(async () => {});
const mockUpdateTaskSchedule = vi.fn(async () => true);
const mockDeleteTask = vi.fn(async () => true);
const mockRecordRun = vi.fn(async () => {});

vi.mock("../../agent/db/repos/tasks.js", () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  getEnabledTasks: (...args: unknown[]) => mockGetEnabledTasks(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTaskSchedule: (...args: unknown[]) => mockUpdateTaskSchedule(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  recordRun: (...args: unknown[]) => mockRecordRun(...args),
}));

vi.mock("../../agent/db/repos/loop.js", () => ({
  getLoopState: vi.fn(async () => ({ active: false, mode: "restricted", intervalMs: 300000 })),
}));

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../agent/prompts/loop-phases.js", () => ({
  buildScheduledAlertPrompt: vi.fn((msg: string) => `Alert: ${msg}`),
  buildPhasePrompt: vi.fn(() => "phase prompt"),
}));

vi.mock("../../agent/snapshot.js", () => ({
  takeSnapshot: vi.fn(async () => 1),
}));

vi.mock("../../agent/executor.js", () => ({
  isMutatingCommand: vi.fn(() => false),
}));

vi.mock("../../agent/tool-registry.js", () => ({
  supportsYes: vi.fn(() => false),
}));

vi.mock("../../agent/trade-capture.js", () => ({
  captureTradeFromResult: vi.fn(async () => []),
  detectCapturedTradeCommand: vi.fn(() => null),
}));

vi.mock("../../agent/echo-loop.js", () => ({
  startEchoLoop: vi.fn(async () => {}),
  stopEchoLoop: vi.fn(async () => {}),
}));

vi.mock("../../agent/subagent.js", () => ({
  recoverOrphanedSubagents: vi.fn(async () => {}),
}));

vi.mock("../../agent/topup-monitor.js", () => ({
  startMonitor: vi.fn(),
}));

vi.mock("../../agent/echo-papa.js", () => ({
  runEchoPapaCycle: vi.fn(async () => ({ success: true })),
}));

const { initScheduler } = await import("../../agent/scheduler.js");

describe("scheduler built-in task defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTasks.mockResolvedValue([]);
    mockGetEnabledTasks.mockResolvedValue([]);
  });

  it("upgrades the builtin portfolio snapshot from hourly to every 30 minutes", async () => {
    mockListTasks.mockResolvedValue([
      {
        id: "builtin-portfolio-snapshot",
        name: "Portfolio Snapshot",
        description: "Auto-capture balances every hour",
        cronExpression: "0 * * * *",
        taskType: "snapshot",
        payload: {},
        enabled: true,
        loopMode: "restricted",
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
        lastResult: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "builtin-auto-backup",
        name: "Auto Backup",
        description: "Backup agent data to 0G Storage every hour",
        cronExpression: "30 * * * *",
        taskType: "backup",
        payload: {},
        enabled: true,
        loopMode: "restricted",
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
        lastResult: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "builtin-echo-papa",
        name: "Echo Papa",
        description: "LLM-powered knowledge steward",
        cronExpression: "*/30 * * * *",
        taskType: "echo_papa",
        payload: {},
        enabled: true,
        loopMode: "restricted",
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
        lastResult: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    await initScheduler();

    expect(mockUpdateTaskSchedule).toHaveBeenCalledWith(
      "builtin-portfolio-snapshot",
      "*/30 * * * *",
      "Auto-capture balances every 30 minutes",
    );
  });
});
