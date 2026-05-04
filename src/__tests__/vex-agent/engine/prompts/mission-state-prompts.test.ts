import { describe, expect, it } from "vitest";

import type { EngineContext } from "../../../../vex-agent/engine/types.js";
import {
  buildMissionRunPrompt,
  buildMissionSetupPrompt,
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

    expect(prompt).toContain("This is draft-planning mode, not mission execution");
    expect(prompt).toContain("avoid deep research loops during setup");
    expect(prompt).toContain("`mission_draft_update` is the source of truth for readiness");
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
  });
});
