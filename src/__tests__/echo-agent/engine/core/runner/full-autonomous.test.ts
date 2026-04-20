/**
 * PR-10 — full-autonomous runner integration smoke tests.
 *
 * Covers:
 *   - `processFullAutonomousTurn` saves the user message, hydrates, and
 *     runs the loop with sessionKind="full_autonomous" + loopMode="full".
 *   - `resumeFullAutonomousSession` does NOT save a user message (the wake
 *     banner persisted by PR-7 is the trigger).
 *   - Defense-in-depth — runner refuses to execute when hydrated session
 *     kind isn't `full_autonomous`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveProvider = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockAddMessage = vi.fn();

vi.mock("@echo-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("../../../../../echo-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("../../../../../echo-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
}));

const { processFullAutonomousTurn, resumeFullAutonomousSession } = await import(
  "../../../../../echo-agent/engine/core/runner/full-autonomous.js"
);

const config = { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD" as const, cachePricePerM: null, reasoningPricePerM: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveProvider.mockResolvedValue({ loadConfig: vi.fn().mockResolvedValue(config) });
  mockHydrate.mockResolvedValue({
    context: {
      sessionId: "s1",
      sessionKind: "full_autonomous",
      loopMode: "full",
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map(),
      memoryScopeKey: "s1",
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  });
  mockRunTurnLoop.mockResolvedValue({
    text: "full-auto turn result",
    toolCallsMade: 1,
    pendingApprovals: [],
    stopReason: "waiting_for_wake",
  });
});

describe("full-autonomous runner", () => {
  it("processFullAutonomousTurn saves the user message then enters the loop", async () => {
    const result = await processFullAutonomousTurn("s1", "start autonomous mode");

    expect(mockAddMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ role: "user", content: "start autonomous mode" }),
      expect.objectContaining({ source: "user", messageType: "chat" }),
    );
    expect(mockRunTurnLoop).toHaveBeenCalled();
    const loopCtx = mockRunTurnLoop.mock.calls[0]![0];
    expect(loopCtx.sessionKind).toBe("full_autonomous");
    expect(loopCtx.loopMode).toBe("full");
    expect(result.stopReason).toBe("waiting_for_wake");
    expect(result.missionStatus).toBeNull();
  });

  it("resumeFullAutonomousSession does NOT save a user message", async () => {
    const result = await resumeFullAutonomousSession("s1");

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRunTurnLoop).toHaveBeenCalled();
    expect(result.stopReason).toBe("waiting_for_wake");
  });

  it("throws when the hydrated session is not full_autonomous (defense in depth)", async () => {
    mockHydrate.mockResolvedValue({
      context: {
        sessionId: "s1",
        sessionKind: "chat",
        loopMode: "off",
        missionId: null,
        missionRunId: null,
        isSubagent: false,
        loadedDocuments: new Map(),
        memoryScopeKey: "s1",
      },
      messages: [],
      summary: null,
      tokenCount: 0,
    });

    await expect(resumeFullAutonomousSession("s1")).rejects.toThrow(/non-full_autonomous/);
  });

  it("throws when the session is missing", async () => {
    mockHydrate.mockResolvedValue(null);
    await expect(processFullAutonomousTurn("ghost", "hi")).rejects.toThrow(/not found/);
  });
});
