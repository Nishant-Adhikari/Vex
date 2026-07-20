/**
 * Mission-run prompt — the `mission_stop(summary=...)` authoring guidance.
 *
 * The `summary` the agent passes to `mission_stop` is the ONLY prose a user
 * ever reads about their run. Without explicit guidance the model writes it
 * in trader shorthand ("flattened TP1, -17bps round-trip"), which is
 * unreadable for the non-technical operator the mission UI is built for.
 *
 * These assertions pin the contract of that guidance: bulleted, dollar-
 * denominated, jargon-free. They are deliberately behavioural (what the
 * instruction must require) rather than a snapshot of the exact wording, so
 * copy edits stay cheap.
 */

import { describe, expect, it } from "vitest";

import type { EngineContext } from "../../../../vex-agent/engine/types.js";
import { buildMissionRunPrompt } from "../../../../vex-agent/engine/prompts/mission-run.js";

function missionContext(): EngineContext {
  return {
    sessionId: "session-1",
    sessionKind: "mission",
    sessionPermission: "restricted",
    missionId: "mission-1",
    missionRunId: "run-1",
    isSubagent: false,
    loadedDocuments: new Map(),
  };
}

describe("mission-run prompt — mission_stop summary guidance", () => {
  it("tells the agent the summary is the user-facing mission summary", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    expect(prompt).toContain("user-facing Mission Summary");
    expect(prompt).toContain("NON-technical");
  });

  it("requires 3-6 short bullets, one beat per line, never a paragraph", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    expect(prompt).toContain("3-6 short BULLET POINTS");
    expect(prompt).toContain('starting with "- "');
    expect(prompt).toContain("do NOT write a paragraph");
  });

  it("names the beats the summary must cover, in order", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    // what you looked for -> what you bought and why -> how much (vs the cap)
    // -> the plan in plain words -> how it ended, in dollars.
    expect(prompt).toContain("what you were looking for");
    expect(prompt).toContain("what you actually bought and WHY you picked it");
    expect(prompt).toContain("how that compares to the cap");
    expect(prompt).toContain("automatic sell levels");
    expect(prompt).toContain("net gain or loss");
  });

  it("frames outcomes in dollars, not the bankroll's native unit", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    expect(prompt).toContain("DOLLARS");
  });

  it("bans the internal trading jargon that leaks into raw model prose", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    expect(prompt).toContain("NO jargon or internal terms");
    for (const banned of ["bps", "TP", "SL", "flatten", "round-trip", "slippage", "basis points"]) {
      expect(prompt).toContain(banned);
    }
    expect(prompt).toContain("no chain IDs");
  });

  it("gives concrete plain-language exemplars the model can imitate", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    expect(prompt).toContain("Looked at 12 trending coins");
    expect(prompt).toContain("well under your $20 limit");
    expect(prompt).toContain("Set an automatic take-profit and a safety stop");
    expect(prompt).toContain("down 17 cents to trading fees");
  });

  it("requires one short, honest line per bullet — losses owned plainly", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    expect(prompt).toContain("one short, honest line");
    expect(prompt).toContain("own the losses plainly");
  });

  it("keeps the guidance attached to the mission_stop rule block", () => {
    const prompt = buildMissionRunPrompt(missionContext());

    const stopRuleIdx = prompt.indexOf("mission_stop(reason=");
    const guidanceIdx = prompt.indexOf("user-facing Mission Summary");
    const contractRuleIdx = prompt.indexOf("For any non-success reason");

    expect(stopRuleIdx).toBeGreaterThan(-1);
    expect(guidanceIdx).toBeGreaterThan(stopRuleIdx);
    expect(guidanceIdx).toBeLessThan(contractRuleIdx);
  });
});
