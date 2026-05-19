/**
 * `effectiveRecallSeed` priority tests.
 *
 * Covers the 4-priority resolver:
 *   1. Post-wake (lastEngineMessage.messageType === "wake_due")
 *   2. Mission with history (assistant plan + open loops)
 *   3. Mission with no history (recent narrative-memory themes OR null)
 *   4. Agent / fallback (last user input)
 *
 * PR2 cutover: priority 3 was `recentEpisodeTitles` → now `recentThemes`
 * sourced from `session_memories` via `getSessionMemoryStats`.
 * PR4 sunset: priority 1 used to be an active compact handoff path; removed
 * with the legacy handoff table.
 */

import { describe, it, expect } from "vitest";
import { effectiveRecallSeed } from "../../../../vex-agent/engine/core/recall-seed.js";
import type { Message } from "../../../../vex-agent/db/repos/messages.js";

function msg(role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  return { role, content, timestamp: "2026-04-20T12:00:00.000Z", ...extra };
}

describe("effectiveRecallSeed", () => {
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

  it("picks assistant plan + open loops for an active mission run with history", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: true,
      messages: [
        msg("user", "kickoff"),
        msg("assistant", "Plan: 1) fetch prices 2) place bet 3) monitor"),
      ],
      openLoops: ["step 3 pending"],
    });
    expect(seed).toContain("Plan:");
    expect(seed).toContain("step 3 pending");
  });

  it("falls back to recent narrative-memory themes for empty mission session", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: false,
      messages: [],
      recentThemes: [
        "kyber_quote_timeout_pattern",
        "wif_position_unwind_signal",
        "wallet_balance_drift_observed",
      ],
    });
    expect(seed).toContain("kyber_quote_timeout_pattern");
  });

  it("filters empty and whitespace themes before falling back", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: false,
      messages: [],
      recentThemes: ["   ", "", "real_theme_here"],
    });
    expect(seed).toContain("real_theme_here");
  });

  it("returns null for empty mission session with zero history", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "mission",
      missionRunActive: false,
      messages: [],
    });
    expect(seed).toBeNull();
  });

  it("uses last user input as the agent fallback", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "agent",
      missionRunActive: false,
      messages: [
        msg("user", "hello"),
        msg("assistant", "hi"),
        msg("user", "what's the balance?"),
      ],
    });
    expect(seed).toBe("what's the balance?");
  });

  it("returns null when agent has no user input at all", () => {
    const seed = effectiveRecallSeed({
      sessionKind: "agent",
      missionRunActive: false,
      messages: [],
    });
    expect(seed).toBeNull();
  });

  it("wake_due beats history beats user input", () => {
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
    });
    expect(seed).toContain("wake reason");
    expect(seed).toContain("objective");
    expect(seed).toContain("loop");
  });
});
