import { describe, expect, it, vi, beforeEach } from "vitest";

// buildMissionRunPrompt reads `strategyDiscipline` fresh via loadConfig() at
// build time. A mutable stub lets each prompt test drive a different rule set
// without a real config file — the parse/module tests below use the REAL
// (spread-through) exports.
let mockStrategyDiscipline: unknown = undefined;
vi.mock("@config/store.js", async (importActual) => {
  const actual = await importActual<typeof import("@config/store.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      ...actual.getDefaultConfig(),
      strategyDiscipline: mockStrategyDiscipline,
    }),
  };
});

import { parseStrategyDiscipline, type StrategyDiscipline } from "@config/store.js";
import {
  buildStrategyDisciplineLines,
  buildStrategyDisciplineSection,
} from "@vex-agent/engine/prompts/strategy-discipline.js";
import { buildMissionRunPrompt } from "@vex-agent/engine/prompts/index.js";
import type { EngineContext } from "@vex-agent/engine/types.js";

function makeMissionRunContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    sessionId: "session-1",
    sessionKind: "mission",
    sessionPermission: "restricted",
    missionId: "mission-1",
    missionRunId: "run-1",
    isSubagent: false,
    loadedDocuments: new Map(),
    ...overrides,
  };
}

// ── (a) config parse ─────────────────────────────────────────────────

describe("parseStrategyDiscipline", () => {
  it("returns undefined when the section is absent", () => {
    expect(parseStrategyDiscipline(undefined)).toBeUndefined();
  });

  it("accepts an empty object — every field is optional (all rules disabled)", () => {
    expect(parseStrategyDiscipline({})).toEqual({});
  });

  it("accepts each field independently", () => {
    expect(parseStrategyDiscipline({ requireThesis: true })).toEqual({ requireThesis: true });
    expect(parseStrategyDiscipline({ requireInvalidation: true })).toEqual({ requireInvalidation: true });
    expect(parseStrategyDiscipline({ minSignalsToAgree: 3 })).toEqual({ minSignalsToAgree: 3 });
    expect(parseStrategyDiscipline({ requirePositionSizeRationale: true })).toEqual({
      requirePositionSizeRationale: true,
    });
    expect(parseStrategyDiscipline({ maxHoldMinutes: 45 })).toEqual({ maxHoldMinutes: 45 });
    // Explicit "off" values are valid too.
    expect(parseStrategyDiscipline({ minSignalsToAgree: 0 })).toEqual({ minSignalsToAgree: 0 });
    expect(parseStrategyDiscipline({ maxHoldMinutes: null })).toEqual({ maxHoldMinutes: null });
  });

  it("accepts a full combination", () => {
    const cfg = {
      requireThesis: true,
      requireInvalidation: true,
      minSignalsToAgree: 3,
      requirePositionSizeRationale: true,
      maxHoldMinutes: 60,
    };
    expect(parseStrategyDiscipline(cfg)).toEqual(cfg);
  });

  it("rejects invalid sections by dropping them (returns undefined)", () => {
    expect(parseStrategyDiscipline({ requireThesis: "yes" })).toBeUndefined();
    expect(parseStrategyDiscipline({ minSignalsToAgree: -1 })).toBeUndefined();
    expect(parseStrategyDiscipline({ minSignalsToAgree: 1.5 })).toBeUndefined();
    expect(parseStrategyDiscipline({ maxHoldMinutes: 0 })).toBeUndefined();
    expect(parseStrategyDiscipline({ maxHoldMinutes: -10 })).toBeUndefined();
    expect(parseStrategyDiscipline({ unknownRule: true })).toBeUndefined();
    expect(parseStrategyDiscipline(42)).toBeUndefined();
  });
});

// ── (b) discipline module emits exactly the enabled rules ────────────

describe("buildStrategyDisciplineLines", () => {
  it("emits nothing when the section is absent or empty (all default off)", () => {
    expect(buildStrategyDisciplineLines(undefined)).toEqual([]);
    expect(buildStrategyDisciplineLines({})).toEqual([]);
  });

  it("treats explicit off / zero / null values as disabled", () => {
    expect(
      buildStrategyDisciplineLines({
        requireThesis: false,
        requireInvalidation: false,
        minSignalsToAgree: 0,
        requirePositionSizeRationale: false,
        maxHoldMinutes: null,
      }),
    ).toEqual([]);
  });

  it("emits only the enabled rules, in stable order", () => {
    const lines = buildStrategyDisciplineLines({
      requireThesis: true,
      requirePositionSizeRationale: true,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("THESIS (required)");
    expect(lines[1]).toContain("POSITION SIZE (required)");
    // Disabled rules must not appear.
    expect(lines.join("\n")).not.toContain("INVALIDATION");
    expect(lines.join("\n")).not.toContain("SIGNAL AGREEMENT");
    expect(lines.join("\n")).not.toContain("MAX HOLD");
  });

  it("interpolates N for minSignalsToAgree (with singular/plural)", () => {
    expect(buildStrategyDisciplineLines({ minSignalsToAgree: 3 })[0]).toContain(
      "at least 3 independent signals to AGREE",
    );
    expect(buildStrategyDisciplineLines({ minSignalsToAgree: 1 })[0]).toContain(
      "at least 1 independent signal to AGREE",
    );
  });

  it("interpolates M for maxHoldMinutes (with singular/plural)", () => {
    expect(buildStrategyDisciplineLines({ maxHoldMinutes: 45 })[0]).toContain(
      "longer than 45 minutes",
    );
    expect(buildStrategyDisciplineLines({ maxHoldMinutes: 1 })[0]).toContain(
      "longer than 1 minute",
    );
  });

  it("emits all five lines when everything is enabled", () => {
    const lines = buildStrategyDisciplineLines({
      requireThesis: true,
      requireInvalidation: true,
      minSignalsToAgree: 2,
      requirePositionSizeRationale: true,
      maxHoldMinutes: 30,
    });
    expect(lines).toHaveLength(5);
  });
});

describe("buildStrategyDisciplineSection", () => {
  it("returns an empty string when no rule is enabled", () => {
    expect(buildStrategyDisciplineSection(undefined)).toBe("");
    expect(buildStrategyDisciplineSection({})).toBe("");
  });

  it("renders the ## Strategy Discipline heading with the enabled rules", () => {
    const section = buildStrategyDisciplineSection({
      requireThesis: true,
      minSignalsToAgree: 3,
    });
    expect(section.startsWith("## Strategy Discipline")).toBe(true);
    expect(section).toContain("THESIS (required)");
    expect(section).toContain("at least 3 independent signals to AGREE");
    expect(section).not.toContain("MAX HOLD");
  });
});

// ── (c) buildMissionRunPrompt block inclusion/omission ───────────────

describe("buildMissionRunPrompt strategy-discipline block", () => {
  beforeEach(() => {
    mockStrategyDiscipline = undefined;
  });

  it("omits the block entirely when no rule is enabled", () => {
    mockStrategyDiscipline = undefined;
    const prompt = buildMissionRunPrompt(makeMissionRunContext(), {
      missionPromptContext: "# Mission: SOL Sprint",
      iterationCount: 0,
    });
    expect(prompt).not.toContain("## Strategy Discipline");
  });

  it("omits the block when the section is present but every rule is off", () => {
    mockStrategyDiscipline = { requireThesis: false, minSignalsToAgree: 0, maxHoldMinutes: null };
    const prompt = buildMissionRunPrompt(makeMissionRunContext(), {
      missionPromptContext: "# Mission: SOL Sprint",
      iterationCount: 0,
    });
    expect(prompt).not.toContain("## Strategy Discipline");
  });

  it("injects the block with only the enabled rules when configured", () => {
    mockStrategyDiscipline = {
      requireThesis: true,
      requireInvalidation: true,
      minSignalsToAgree: 3,
    } satisfies StrategyDiscipline;
    const prompt = buildMissionRunPrompt(makeMissionRunContext(), {
      missionPromptContext: "# Mission: SOL Sprint",
      iterationCount: 0,
    });
    expect(prompt).toContain("## Strategy Discipline");
    expect(prompt).toContain("THESIS (required)");
    expect(prompt).toContain("INVALIDATION (required)");
    expect(prompt).toContain("at least 3 independent signals to AGREE");
    // Not-enabled rules stay out.
    expect(prompt).not.toContain("POSITION SIZE (required)");
    expect(prompt).not.toContain("MAX HOLD (required)");
    // The pre-existing mission-run content is undisturbed.
    expect(prompt).toContain("# Mission Execution");
    expect(prompt).toContain("# Mission: SOL Sprint");
  });
});
