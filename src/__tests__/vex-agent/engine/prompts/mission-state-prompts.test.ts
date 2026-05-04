import { describe, expect, it } from "vitest";

import type { EngineContext } from "../../../../vex-agent/engine/types.js";
import {
  buildPromptStack,
  buildMissionRunPrompt,
  buildMissionSetupPrompt,
  buildToolUsagePrompt,
} from "../../../../vex-agent/engine/prompts/index.js";

function makeMissionContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    sessionId: "session-1",
    sessionKind: "mission",
    loopMode: "restricted",
    missionId: "mission-1",
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map(),
    memoryScopeKey: "session-1",
    ...overrides,
  };
}

describe("mission state prompts", () => {
  it("makes mission setup a draft-planning flow with tool-backed readiness", () => {
    const prompt = buildMissionSetupPrompt(makeMissionContext());

    expect(prompt).toContain("Draft-first");
    expect(prompt).toContain("Do not do broad market research during setup");
    expect(prompt).toContain("research belongs after mission start unless the user explicitly asks for preflight research");
    expect(prompt).toContain("`mission_draft_update` is the source of truth for readiness");
  });

  it("treats partial meme-token mission ideas as draft input instead of research triggers", () => {
    const prompt = buildMissionSetupPrompt(makeMissionContext());

    expect(prompt).toContain("hunt Solana meme tokens with $6");
    expect(prompt).toContain("treat it as draft input");
    expect(prompt).toContain("Do not turn a partial mission idea into a token/market research session");
  });

  it("lets mode-specific instructions override generic research workflow", () => {
    const prompt = buildToolUsagePrompt();

    expect(prompt).toContain("Mode-specific instructions override this generic research workflow");
    expect(prompt).toMatch(/In mission\s+setup, default to draft-first behavior/);
    expect(prompt).toMatch(/In mission run, research must end\s+in an actionable decision/);
  });

  it("makes active mission runs ignore stale setup start instructions", () => {
    const prompt = buildMissionRunPrompt(
      makeMissionContext({ missionRunId: "run-1" }),
      {
        missionPromptContext: "# Mission: SOL Sprint",
        iterationCount: 0,
      },
    );

    expect(prompt).toContain("shell activation command (`/mission start` or `/mission continue`) has already been executed");
    expect(prompt).toContain("Treat earlier setup messages asking for `/mission start` as historical context only");
    expect(prompt).toContain("do not call `loop_defer` because you are waiting for mission activation");
    expect(prompt).toContain("each research loop must produce a shortlist, an execution candidate, a defer decision, or a contract-valid stop");
  });

  it("keeps full-autonomous wording separate from mission contracts", () => {
    const prompt = buildPromptStack(
      makeMissionContext({
        sessionKind: "full_autonomous",
        loopMode: "full",
        missionId: null,
      }),
    ).join("\n");

    expect(prompt).toContain("There is no frozen mission contract");
    expect(prompt).not.toContain("fulfill your mission");
  });
});
