/**
 * PR-10 — `effectiveRecallSeed` priority tests.
 *
 * Covers the 5-priority resolver:
 *   1. Active handoff (handoff.payload.preferredRecallQuery)
 *   2. Post-wake (lastEngineMessage.messageType === "wake_due")
 *   3. Mission / full-autonomous with history
 *   4. Empty full-autonomous (recent episode titles OR null)
 *   5. Chat / fallback (last user input)
 */

import { describe, it, expect } from "vitest";
import { effectiveRecallSeed } from "../../../../vex-agent/engine/core/recall-seed.js";
import type { Message } from "../../../../vex-agent/db/repos/messages.js";
import type { CheckpointHandoff } from "../../../../vex-agent/db/repos/checkpoint-handoffs.js";

function msg(role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  return { role, content, timestamp: "2026-04-20T12:00:00.000Z", ...extra };
}

function handoff(query: string): CheckpointHandoff {
  return {
    id: "h-1",
    sessionId: "s1",
    targetCheckpointGeneration: 3,
    status: "active",
    createdAt: "2026-04-20T11:00:00.000Z",
    consumedAt: null,
    payload: {
      preserveMd: "",
      preferredRecallQuery: query,
      importantEntities: [],
      openLoops: [],
    },
  };
}

describe("effectiveRecallSeed", () => {
  it("picks handoff.preferredRecallQuery first when available", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [msg("user", "old message")],
      activeHandoff: handoff("resume bet monitoring"),
    });
    expect(seed).toBe("resume bet monitoring");
  });

  it("ignores handoff when preferredRecallQuery is empty (falls to next priority)", () => {
    const empty = handoff("");
    const seed = effectiveRecallSeed({
      sessionKind: "chat",
      missionRunActive: false,
      messages: [msg("user", "last chat line")],
      activeHandoff: empty,
    });
    expect(seed).toBe("last chat line");
  });

  it("combines wake_due reason + mission objective + open loops after wake", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [],
      missionObjective: "Win the polymarket arb",
      openLoops: ["Check USDC balance", "Re-price at T+15"],
      lastEngineMessage: { messageType: "wake_due", reason: "15min elapsed; recheck feed" },
    });
    expect(seed).toContain("15min elapsed");
    expect(seed).toContain("polymarket arb");
    expect(seed).toContain("Check USDC balance");
  });

  it("picks assistant plan + open loops for mission/full-autonomous with history", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "full_autonomous",
      missionRunActive: false,
      messages: [
        msg("user", "kickoff"),
        msg("assistant", "Plan: 1) fetch prices 2) place bet 3) monitor"),
      ],
      openLoops: ["step 3 pending"],
    });
    expect(seed).toContain("Plan:");
    expect(seed).toContain("step 3 pending");
  });

  it("falls back to recent episode titles for empty full_autonomous", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "full_autonomous",
      missionRunActive: false,
      messages: [],
      recentEpisodeTitles: ["Trade signals", "Risk review", "Capital deployment"],
    });
    expect(seed).toContain("Trade signals");
  });

  it("returns null for empty full_autonomous session with zero history", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "full_autonomous",
      missionRunActive: false,
      messages: [],
    });
    expect(seed).toBeNull();
  });

  it("uses last user input as the chat fallback", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "chat",
      missionRunActive: false,
      messages: [
        msg("user", "hello"),
        msg("assistant", "hi"),
        msg("user", "what's the balance?"),
      ],
    });
    expect(seed).toBe("what's the balance?");
  });

  it("returns null when chat has no user input at all", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "chat",
      missionRunActive: false,
      messages: [],
    });
    expect(seed).toBeNull();
  });

  it("handoff beats wake_due beats history beats user input", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [
        msg("user", "u1"),
        msg("assistant", "assistant plan step 1"),
      ],
      missionObjective: "objective",
      openLoops: ["loop"],
      lastEngineMessage: { messageType: "wake_due", reason: "wake reason" },
      activeHandoff: handoff("handoff seed"),
    });
    expect(seed).toBe("handoff seed");
  });
});
