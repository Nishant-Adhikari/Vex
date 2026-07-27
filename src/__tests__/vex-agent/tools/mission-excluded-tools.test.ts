import { describe, it, expect } from "vitest";

const { getOpenAITools, defaultVisibilityContext } = await import(
  "../../../vex-agent/tools/registry.js"
);
const { resolveMissionExcludedTools } = await import(
  "../../../lib/agent-config.js"
);

/** An active-mission-run visibility context (the only place exclusion bites). */
function missionCtx(
  overrides: Partial<Parameters<typeof defaultVisibilityContext>[0]> = {},
) {
  return defaultVisibilityContext({
    sessionKind: "mission",
    missionRunActive: true,
    ...overrides,
  });
}

const names = (ctx: Parameters<typeof getOpenAITools>[0]): string[] =>
  getOpenAITools(ctx).map((t) => t.function.name);

describe("mission-scoped tool exclusion (missionExcludedTools)", () => {
  // Use a tool with no env/mission gating so the baseline is stable.
  const TARGET = "long_memory_search";

  it("hides an excluded tool during an active mission run", () => {
    // Baseline: visible in the SAME context without exclusion.
    expect(names(missionCtx())).toContain(TARGET);
    expect(names(missionCtx({ missionExcludedTools: [TARGET] }))).not.toContain(
      TARGET,
    );
  });

  it("removes ONLY the named tools — the rest of the surface is untouched", () => {
    const before = names(missionCtx());
    const after = names(missionCtx({ missionExcludedTools: [TARGET] }));
    expect(after).toEqual(before.filter((n) => n !== TARGET));
  });

  it("does NOT exclude in an agent session (missionRunActive=false)", () => {
    // Same exclusion list, but not an active mission run → no effect.
    const agent = defaultVisibilityContext({ missionExcludedTools: [TARGET] });
    expect(names(agent)).toContain(TARGET);
  });

  it("empty / undefined exclusion list leaves the full surface", () => {
    const full = names(missionCtx()).length;
    expect(names(missionCtx({ missionExcludedTools: [] })).length).toBe(full);
  });

  it("an unknown tool name is a harmless no-op", () => {
    const before = names(missionCtx());
    const after = names(missionCtx({ missionExcludedTools: ["not_a_real_tool"] }));
    expect(after).toEqual(before);
  });
});

describe("resolveMissionExcludedTools", () => {
  it("returns [] when the env var is unset", () => {
    expect(resolveMissionExcludedTools({})).toEqual([]);
  });

  it("returns [] for a blank / whitespace-only value (fail-open)", () => {
    expect(
      resolveMissionExcludedTools({ AGENT_MISSION_EXCLUDED_TOOLS: "   " }),
    ).toEqual([]);
  });

  it("parses a comma-separated list, trimming and dropping empty entries", () => {
    expect(
      resolveMissionExcludedTools({
        AGENT_MISSION_EXCLUDED_TOOLS:
          " hyperliquid_enter , polymarket_setup ,, bridge ",
      }),
    ).toEqual(["hyperliquid_enter", "polymarket_setup", "bridge"]);
  });
});
