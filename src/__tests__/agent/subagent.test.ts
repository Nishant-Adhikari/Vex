import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../agent/engine.js", () => ({
  createSession: vi.fn(() => ({ id: "session-mock-1", messages: [], loadedKnowledge: new Map(), inferenceConfig: {} })),
  processMessage: vi.fn(async () => {}),
}));
vi.mock("../../agent/session-hydrate.js", () => ({
  hydrateSession: vi.fn(async () => null),
}));
vi.mock("../../agent/session-lock.js", () => ({
  withSessionLock: vi.fn(async (_id: string, fn: () => Promise<void>) => fn()),
}));
vi.mock("../../agent/autonomy-inbox.js", () => ({
  publish: vi.fn(async () => {}),
}));
vi.mock("../../agent/db/repos/subagents.js", () => ({
  insert: vi.fn(async () => {}),
  updateStatus: vi.fn(async () => {}),
  getById: vi.fn(async () => null),
  getActive: vi.fn(async () => []),
  getRecent: vi.fn(async () => []),
  markOrphansInterrupted: vi.fn(async () => 0),
  incrementIterations: vi.fn(async () => {}),
}));
vi.mock("../../agent/db/repos/sessions.js", () => ({
  createSession: vi.fn(async () => {}),
  setScope: vi.fn(async () => {}),
}));
vi.mock("../../agent/resilience.js", () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => promise),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { spawnSubagent, getSubagentStatus, stopSubagent, recoverOrphanedSubagents, getActiveCount } from "../../agent/subagent.js";
import * as subagentRepo from "../../agent/db/repos/subagents.js";

describe("subagent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("spawnSubagent", () => {
    it("returns id and name immediately", async () => {
      const result = await spawnSubagent({ name: "EchoSpark", task: "Analyze SOL" });
      expect(result.id).toMatch(/^subagent-/);
      expect(result.name).toBe("EchoSpark");
      expect(result.error).toBeUndefined();
    });

    it("persists subagent to DB", async () => {
      await spawnSubagent({ name: "EchoTest", task: "Test task" });
      expect(subagentRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ name: "EchoTest", task: "Test task", allowTrades: false }),
      );
    });

    it("rejects duplicate active names", async () => {
      await spawnSubagent({ name: "EchoDupe", task: "Task 1" });
      const result = await spawnSubagent({ name: "EchoDupe", task: "Task 2" });
      expect(result.error).toContain("already running");
    });

    it("enforces max concurrent limit", async () => {
      await spawnSubagent({ name: "Echo1", task: "T1" });
      await spawnSubagent({ name: "Echo2", task: "T2" });
      await spawnSubagent({ name: "Echo3", task: "T3" });
      const result = await spawnSubagent({ name: "Echo4", task: "T4" });
      expect(result.error).toContain("Max concurrent");
    });

    it("passes allow_trades flag", async () => {
      await spawnSubagent({ name: "EchoTrader", task: "Trade SOL", allowTrades: true });
      expect(subagentRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ allowTrades: true }),
      );
    });
  });

  describe("getSubagentStatus", () => {
    it("returns empty array when no subagents", async () => {
      const result = await getSubagentStatus();
      expect(result).toEqual([]);
    });
  });

  describe("recoverOrphanedSubagents", () => {
    it("calls markOrphansInterrupted", async () => {
      await recoverOrphanedSubagents();
      expect(subagentRepo.markOrphansInterrupted).toHaveBeenCalled();
    });
  });

  describe("getActiveCount", () => {
    it("starts at 0", () => {
      expect(getActiveCount()).toBe(0);
    });
  });
});
