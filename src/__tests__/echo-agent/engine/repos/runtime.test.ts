import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);

vi.mock("@echo-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: vi.fn().mockResolvedValue([]),
}));

const {
  getState, setActiveLoop, updatePhase, stopLoop,
  recordCycleStart, recordCycleEnd,
} = await import("../../../../echo-agent/db/repos/runtime.js");

describe("runtime repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getState ────────────────────────────────────────────────

  describe("getState", () => {
    it("returns defaults when no row", async () => {
      const state = await getState();
      expect(state.active).toBe(false);
      expect(state.mode).toBe("restricted");
      expect(state.intervalMs).toBe(300000);
      expect(state.currentPhase).toBe("idle");
      expect(state.cycleCount).toBe(0);
    });

    it("maps row correctly", async () => {
      mockQueryOne.mockResolvedValueOnce({
        active: true,
        mode: "full",
        interval_ms: 60000,
        current_phase: "sense",
        phase_started_at: new Date("2026-03-28T10:00:00Z"),
        loop_session_id: "session-loop",
        started_at: new Date("2026-03-28T09:00:00Z"),
        last_cycle_at: new Date("2026-03-28T10:05:00Z"),
        cycle_count: 42,
      });

      const state = await getState();
      expect(state.active).toBe(true);
      expect(state.mode).toBe("full");
      expect(state.intervalMs).toBe(60000);
      expect(state.currentPhase).toBe("sense");
      expect(state.loopSessionId).toBe("session-loop");
      expect(state.cycleCount).toBe(42);
    });
  });

  // ── setActiveLoop ───────────────────────────────────────────

  describe("setActiveLoop", () => {
    it("activates loop with params", async () => {
      await setActiveLoop("restricted", 120000, "session-1");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("active = TRUE");
      expect(sql).toContain("mode = $1");
      expect(sql).toContain("interval_ms = $2");
      expect(sql).toContain("loop_session_id = $3");
      expect(params).toEqual(["restricted", 120000, "session-1"]);
    });
  });

  // ── updatePhase ─────────────────────────────────────────────

  describe("updatePhase", () => {
    it("sets phase and timestamp", async () => {
      await updatePhase("execute");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("current_phase = $1");
      expect(sql).toContain("phase_started_at = NOW()");
      expect(params).toEqual(["execute"]);
    });
  });

  // ── stopLoop ────────────────────────────────────────────────

  describe("stopLoop", () => {
    it("deactivates and resets phase", async () => {
      await stopLoop();
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("active = FALSE");
      expect(sql).toContain("current_phase = 'idle'");
    });
  });

  // ── recordCycleStart ────────────────────────────────────────

  describe("recordCycleStart", () => {
    it("inserts cycle and returns id", async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 42 });
      const id = await recordCycleStart(5);
      expect(id).toBe(42);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("INSERT INTO runtime_cycles");
      expect(params).toEqual([5]);
    });
  });

  // ── recordCycleEnd ──────────────────────────────────────────

  describe("recordCycleEnd", () => {
    it("updates cycle with outcome", async () => {
      await recordCycleEnd(42, ["sense", "assess"], "completed");
      expect(mockExecute).toHaveBeenCalledTimes(2); // cycle update + state update
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE runtime_cycles");
      expect(params).toContain(42);
      expect(params).toContainEqual(["sense", "assess"]);
      expect(params).toContain("completed");
    });

    it("increments cycle_count on completed", async () => {
      await recordCycleEnd(42, ["sense"], "completed");
      const [sql] = mockExecute.mock.calls[1];
      expect(sql).toContain("cycle_count = cycle_count + 1");
    });

    it("does not increment on error", async () => {
      await recordCycleEnd(42, ["sense"], "error", "timeout");
      expect(mockExecute).toHaveBeenCalledTimes(1); // only cycle update, no state update
    });
  });
});
