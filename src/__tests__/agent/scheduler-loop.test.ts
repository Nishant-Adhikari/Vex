import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing scheduler
vi.mock("../../agent/db/repos/tasks.js", () => ({
  listTasks: vi.fn(async () => []),
  getEnabledTasks: vi.fn(async () => []),
  createTask: vi.fn(),
  updateTaskSchedule: vi.fn(),
  deleteTask: vi.fn(),
  recordRun: vi.fn(),
}));
vi.mock("../../agent/db/repos/loop.js", () => ({
  getLoopState: vi.fn(async () => ({ active: false, mode: "restricted", intervalMs: 300000, currentPhase: "idle", phaseStartedAt: null, loopSessionId: null })),
  recordCycle: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../agent/prompts/loop-phases.js", () => ({
  buildScheduledAlertPrompt: vi.fn((msg: string) => `Alert: ${msg}`),
  buildPhasePrompt: vi.fn(() => "phase prompt"),
}));
vi.mock("../../agent/snapshot.js", () => ({
  takeSnapshot: vi.fn(async () => "snap-123"),
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

// Mock echo-loop — startLoopEngine and stopLoopEngine now delegate here
const mockStartEchoLoop = vi.fn(async () => {});
const mockStopEchoLoop = vi.fn(async () => {});
vi.mock("../../agent/echo-loop.js", () => ({
  startEchoLoop: (...a: unknown[]) => mockStartEchoLoop(...a),
  stopEchoLoop: () => mockStopEchoLoop(),
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

import { startLoopEngine, stopLoopEngine, setInferenceHandler } from "../../agent/scheduler.js";

describe("loop engine (delegated to echo-loop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setInferenceHandler(null);
  });

  it("delegates start to echo-loop with mode and interval", async () => {
    await startLoopEngine("restricted", 5000);
    expect(mockStartEchoLoop).toHaveBeenCalledWith("restricted", 5000);
  });

  it("delegates stop to echo-loop", async () => {
    await stopLoopEngine();
    expect(mockStopEchoLoop).toHaveBeenCalled();
  });

  it("startLoopEngine is async (returns Promise)", () => {
    const result = startLoopEngine("full", 30000);
    expect(result).toBeInstanceOf(Promise);
  });
});
