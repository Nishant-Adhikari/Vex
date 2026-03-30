import { describe, it, expect, vi } from "vitest";

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(), query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null),
}));

const { handleMissionStop } = await import("../../../../echo-agent/tools/internal/mission.js");

const baseContext = {
  sessionId: "session-1",
  loadedDocuments: new Map<string, string>(),
  loopMode: "restricted" as const,
  approved: false,
  role: "parent" as const,
  missionRunId: "run-1",
};

describe("mission_stop tool", () => {
  it("returns engineSignal with valid reason", async () => {
    const result = await handleMissionStop(
      { reason: "goal_reached", summary: "Accumulated target SOL" },
      baseContext,
    );
    expect(result.success).toBe(true);
    expect(result.engineSignal).toBeDefined();
    expect(result.engineSignal!.type).toBe("stop_mission");
    expect(result.engineSignal!.reason).toBe("goal_reached");
    expect(result.engineSignal!.summary).toBe("Accumulated target SOL");
  });

  it("accepts all valid stop reasons", async () => {
    const reasons = ["goal_reached", "deadline_reached", "capital_depleted", "max_loss_hit", "no_viable_opportunity"];
    for (const reason of reasons) {
      const result = await handleMissionStop({ reason, summary: "test" }, baseContext);
      expect(result.success).toBe(true);
      expect(result.engineSignal!.reason).toBe(reason);
    }
  });

  it("rejects invalid reason", async () => {
    const result = await handleMissionStop(
      { reason: "bored", summary: "I'm bored" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid stop reason");
  });

  it("requires reason", async () => {
    const result = await handleMissionStop({ summary: "test" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: reason");
  });

  it("requires summary", async () => {
    const result = await handleMissionStop({ reason: "goal_reached" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: summary");
  });

  it("includes optional evidence", async () => {
    const result = await handleMissionStop(
      { reason: "capital_depleted", summary: "No funds left", evidence: { balanceUsd: 0.12 } },
      baseContext,
    );
    expect(result.engineSignal!.evidence).toEqual({ balanceUsd: 0.12 });
  });

  it("rejects when no active mission run (missionRunId null)", async () => {
    const result = await handleMissionStop(
      { reason: "goal_reached", summary: "Done" },
      { ...baseContext, missionRunId: null },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("only valid during an active mission run");
  });

  it("rejects user_stopped (not a model-driven reason)", async () => {
    const result = await handleMissionStop(
      { reason: "user_stopped", summary: "user asked" },
      baseContext,
    );
    expect(result.success).toBe(false);
  });
});
