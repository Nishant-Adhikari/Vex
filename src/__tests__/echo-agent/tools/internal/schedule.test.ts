import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateSchedule = vi.fn().mockResolvedValue(undefined);
const mockDeleteSchedule = vi.fn().mockResolvedValue(true);

vi.mock("@echo-agent/db/repos/schedules.js", () => ({
  createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
  deleteSchedule: (...args: unknown[]) => mockDeleteSchedule(...args),
}));

const { handleScheduleCreate, handleScheduleRemove } = await import("../../../../echo-agent/tools/internal/schedule.js");

const baseContext = {
  sessionId: "test",
  loadedDocuments: new Map<string, string>(),
  loopMode: "off" as const,
  approved: false,
};

describe("schedule handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── schedule_create ─────────────────────────────────────────────

  describe("handleScheduleCreate", () => {
    it("fails without name", async () => {
      const result = await handleScheduleCreate({ cron: "0 * * * *", type: "wake_agent" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("name");
    });

    it("fails without cron", async () => {
      const result = await handleScheduleCreate({ name: "test", type: "wake_agent" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("cron");
    });

    it("fails without type", async () => {
      const result = await handleScheduleCreate({ name: "test", cron: "0 * * * *" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("type");
    });

    it("rejects cli_execute type", async () => {
      const result = await handleScheduleCreate(
        { name: "test", cron: "0 * * * *", type: "cli_execute" },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid task type");
    });

    it("rejects inference type (legacy)", async () => {
      const result = await handleScheduleCreate(
        { name: "test", cron: "0 * * * *", type: "inference" },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid task type");
    });

    it("rejects alert type (legacy)", async () => {
      const result = await handleScheduleCreate(
        { name: "test", cron: "0 * * * *", type: "alert" },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid task type");
    });

    it("rejects invalid cron expression", async () => {
      const result = await handleScheduleCreate(
        { name: "test", cron: "not-a-cron", type: "wake_agent" },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid cron");
    });

    it("accepts valid wake_agent task", async () => {
      const result = await handleScheduleCreate(
        { name: "market check", cron: "0 * * * *", type: "wake_agent", payload: { prompt: "check markets" } },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.taskId).toMatch(/^task-/);
      expect(parsed.type).toBe("wake_agent");
      expect(mockCreateSchedule).toHaveBeenCalledTimes(1);
    });

    it("accepts valid tool_call task", async () => {
      const result = await handleScheduleCreate(
        { name: "balance refresh", cron: "*/30 * * * *", type: "tool_call", payload: { toolName: "khalani.tokens.balances", params: { wallet: "eip155" } } },
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it("accepts valid reminder task", async () => {
      const result = await handleScheduleCreate(
        { name: "daily reminder", cron: "0 9 * * *", type: "reminder", payload: { message: "Check portfolio" } },
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it("accepts valid monitor task", async () => {
      const result = await handleScheduleCreate(
        { name: "price monitor", cron: "*/5 * * * *", type: "monitor", payload: { condition: "SOL price > 200" } },
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it("accepts snapshot type", async () => {
      const result = await handleScheduleCreate(
        { name: "snapshot", cron: "*/30 * * * *", type: "snapshot" },
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    it("accepts backup type", async () => {
      const result = await handleScheduleCreate(
        { name: "backup", cron: "30 * * * *", type: "backup" },
        baseContext,
      );
      expect(result.success).toBe(true);
    });

    // ── Payload validation per type ─────────────────────────────

    it("tool_call requires toolName in payload", async () => {
      const result = await handleScheduleCreate(
        { name: "bad", cron: "0 * * * *", type: "tool_call", payload: {} },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("toolName");
    });

    it("wake_agent requires prompt in payload", async () => {
      const result = await handleScheduleCreate(
        { name: "bad", cron: "0 * * * *", type: "wake_agent", payload: {} },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("prompt");
    });

    it("reminder requires message in payload", async () => {
      const result = await handleScheduleCreate(
        { name: "bad", cron: "0 * * * *", type: "reminder", payload: {} },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("message");
    });

    it("monitor requires condition or prompt in payload", async () => {
      const result = await handleScheduleCreate(
        { name: "bad", cron: "0 * * * *", type: "monitor", payload: {} },
        baseContext,
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("condition");
    });

    // ── loopMode ────────────────────────────────────────────────

    it("sets loopMode=restricted in non-full mode", async () => {
      await handleScheduleCreate(
        { name: "test", cron: "0 * * * *", type: "snapshot" },
        baseContext,
      );
      const scheduleArg = mockCreateSchedule.mock.calls[0][0];
      expect(scheduleArg.loopMode).toBe("restricted");
    });

    it("allows custom loopMode in full mode", async () => {
      const fullContext = { ...baseContext, loopMode: "full" as const };
      await handleScheduleCreate(
        { name: "test", cron: "0 * * * *", type: "snapshot" },
        fullContext,
      );
      const scheduleArg = mockCreateSchedule.mock.calls[0][0];
      expect(scheduleArg.loopMode).toBe("full");
    });

    // ── String payload parsing ──────────────────────────────────

    it("wraps string payload into type-appropriate key", async () => {
      const result = await handleScheduleCreate(
        { name: "test", cron: "0 * * * *", type: "wake_agent", payload: "check SOL price" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const scheduleArg = mockCreateSchedule.mock.calls[0][0];
      expect(scheduleArg.payload.prompt).toBe("check SOL price");
    });
  });

  // ── schedule_remove ─────────────────────────────────────────────

  describe("handleScheduleRemove", () => {
    it("fails without id", async () => {
      const result = await handleScheduleRemove({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("id");
    });

    it("removes existing schedule", async () => {
      const result = await handleScheduleRemove({ id: "task-123" }, baseContext);
      expect(result.success).toBe(true);
      expect(mockDeleteSchedule).toHaveBeenCalledWith("task-123");
    });

    it("returns not found for missing schedule", async () => {
      mockDeleteSchedule.mockResolvedValueOnce(false);
      const result = await handleScheduleRemove({ id: "task-missing" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found");
    });
  });
});
