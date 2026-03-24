import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask } from "../../agent/db/repos/tasks.js";

const scheduledCallbacks: Array<() => Promise<void>> = [];
const mockListTasks = vi.fn(async () => []);
const mockGetEnabledTasks = vi.fn(async () => []);
const mockCreateTask = vi.fn(async () => {});
const mockUpdateTaskSchedule = vi.fn(async () => true);
const mockDeleteTask = vi.fn(async () => true);
const mockRecordRun = vi.fn(async () => {});
const mockExecFile = vi.fn();
const mockIsMutatingCommand = vi.fn(() => false);
const mockSupportsYes = vi.fn(() => false);
const mockDetectCapturedTradeCommand = vi.fn(() => null);
const mockCaptureTradeFromResult = vi.fn(async () => {});

vi.mock("node-cron", () => ({
  default: {
    validate: vi.fn(() => true),
    schedule: vi.fn((_expr: string, callback: () => Promise<void>) => {
      scheduledCallbacks.push(callback);
      return { stop: vi.fn() };
    }),
  },
}));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

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

vi.mock("../../agent/prompts/loop-phases.js", () => ({
  buildScheduledAlertPrompt: vi.fn((msg: string) => `Alert: ${msg}`),
  buildPhasePrompt: vi.fn(() => "phase prompt"),
}));

vi.mock("../../agent/snapshot.js", () => ({
  takeSnapshot: vi.fn(async () => 1),
}));

vi.mock("../../agent/echo-papa.js", () => ({
  runEchoPapaCycle: vi.fn(async () => ({ success: true })),
}));

vi.mock("../../agent/executor.js", () => ({
  isMutatingCommand: (...args: unknown[]) => mockIsMutatingCommand(...args),
}));

vi.mock("../../agent/tool-registry.js", () => ({
  supportsYes: (...args: unknown[]) => mockSupportsYes(...args),
}));

vi.mock("../../agent/trade-capture.js", () => ({
  captureTradeFromResult: (...args: unknown[]) => mockCaptureTradeFromResult(...args),
  detectCapturedTradeCommand: (...args: unknown[]) => mockDetectCapturedTradeCommand(...args),
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

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { initScheduler, stopAll } = await import("../../agent/scheduler.js");

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-cli",
    name: "CLI Task",
    description: "Runs a CLI command",
    cronExpression: "*/5 * * * *",
    taskType: "cli_execute",
    payload: { command: "solana swap execute", args: { amount: "1" } },
    enabled: true,
    loopMode: "full",
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    lastResult: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("scheduler cli_execute trade capture", () => {
  beforeEach(() => {
    scheduledCallbacks.length = 0;
    vi.clearAllMocks();
    mockListTasks.mockResolvedValue([
      makeTask({
        id: "builtin-portfolio-snapshot",
        name: "Portfolio Snapshot",
        description: "Auto-capture balances every 30 minutes",
        taskType: "snapshot",
        payload: {},
      }),
      makeTask({
        id: "builtin-auto-backup",
        name: "Auto Backup",
        description: "Backup agent data to 0G Storage every hour",
        cronExpression: "30 * * * *",
        taskType: "backup",
        payload: {},
      }),
      makeTask({
        id: "builtin-echo-papa",
        name: "Echo Papa",
        description: "LLM-powered knowledge steward",
        taskType: "echo_papa",
        payload: {},
      }),
    ]);
    mockGetEnabledTasks.mockResolvedValue([makeTask()]);
  });

  afterEach(async () => {
    await stopAll();
  });

  it("captures successful cli_execute trades and records parsed JSON output", async () => {
    mockIsMutatingCommand.mockReturnValue(true);
    mockSupportsYes.mockReturnValue(true);
    mockDetectCapturedTradeCommand.mockReturnValue("solana_swap_execute");
    mockExecFile.mockImplementation((
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      cb(null, JSON.stringify({ success: true, signature: "sig-1" }));
    });

    await initScheduler();
    await scheduledCallbacks[0]?.();

    expect(mockExecFile).toHaveBeenCalledWith(
      "echoclaw",
      ["solana", "swap", "execute", "--amount", "1", "--json", "--yes"],
      expect.objectContaining({ timeout: 120000 }),
      expect.any(Function),
    );
    expect(mockCaptureTradeFromResult).toHaveBeenCalledWith(
      "solana_swap_execute",
      ["solana", "swap", "execute", "--amount", "1", "--json", "--yes"],
      JSON.stringify({ success: true, signature: "sig-1" }),
    );
    expect(mockRecordRun).toHaveBeenCalledWith("task-cli", {
      success: true,
      command: "solana swap execute",
      output: { success: true, signature: "sig-1" },
    });
  });

  it("blocks restricted mutating cli_execute tasks before spawning the command", async () => {
    mockGetEnabledTasks.mockResolvedValue([
      makeTask({ id: "task-blocked", loopMode: "restricted" }),
    ]);
    mockIsMutatingCommand.mockReturnValue(true);

    await initScheduler();
    await scheduledCallbacks[0]?.();

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockCaptureTradeFromResult).not.toHaveBeenCalled();
    expect(mockRecordRun).toHaveBeenCalledWith("task-blocked", {
      success: false,
      error: 'Mutating command "solana swap execute" blocked — requires loopMode=full, got "restricted"',
      command: "solana swap execute",
    });
  });
});
