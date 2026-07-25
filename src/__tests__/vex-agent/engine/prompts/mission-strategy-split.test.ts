/**
 * IMMUTABLE SAFETY CORE vs ADAPTIVE tactics split — prompt-assembly tests.
 *
 * Proves guardrail (a): the assembled (core + adaptive) mission strategy prompt
 * always carries every safety-core marker, and the validator REJECTS an assembly
 * that drops one. Also proves the mission-run prompt renders BOTH blocks and
 * that the adaptive content is subordinate to the core.
 */

import { describe, it, expect } from "vitest";
import {
  buildMissionSafetyCorePrompt,
  findMissingSafetyMarkers,
  assertSafetyCorePresent,
  SAFETY_CORE_MARKERS,
} from "@vex-agent/engine/prompts/mission-safety-core.js";
import {
  assembleStrategyPrompt,
  buildAdaptiveStrategyPrompt,
  ADAPTIVE_STRATEGY_BASELINE,
} from "@vex-agent/engine/prompts/mission-adaptive.js";
import { buildMissionRunPrompt } from "@vex-agent/engine/prompts/mission-run.js";
import type { EngineContext } from "@vex-agent/engine/types.js";

const revised = "Prefer verified, liquid tokens and take profit into strength.";

describe("safety-core markers", () => {
  it("every marker is present in the rendered core block", () => {
    const core = buildMissionSafetyCorePrompt();
    for (const marker of SAFETY_CORE_MARKERS) {
      expect(core).toContain(marker);
    }
  });

  it("assembled (core + adaptive) prompt preserves every marker", () => {
    const assembled = assembleStrategyPrompt(buildMissionSafetyCorePrompt(), revised);
    expect(findMissingSafetyMarkers(assembled)).toEqual([]);
    expect(assertSafetyCorePresent(assembled)).toBe(true);
    expect(assembled).toContain(revised);
  });

  it("REJECTS an assembly with a safety clause removed", () => {
    // Simulate an assembly that dropped the stop-loss clause.
    const broken = assembleStrategyPrompt(
      buildMissionSafetyCorePrompt().replace(/stop-loss/g, "xxx"),
      revised,
    );
    const missing = findMissingSafetyMarkers(broken);
    expect(missing).toContain("stop-loss");
    expect(assertSafetyCorePresent(broken)).toBe(false);
  });

  it("adaptive block declares its subordination to the core", () => {
    const block = buildAdaptiveStrategyPrompt(ADAPTIVE_STRATEGY_BASELINE);
    expect(block).toContain("ADAPTIVE STRATEGY");
    expect(block.toLowerCase()).toContain("subordinate");
  });
});

describe("mission-run prompt renders BOTH blocks", () => {
  const ctx = {
    missionRunId: "run-1",
    sessionKind: "mission",
  } as unknown as EngineContext;

  it("includes the immutable core AND the active adaptive content", () => {
    const prompt = buildMissionRunPrompt(ctx, {
      missionPromptContext: "Grow bankroll to 2 ETH",
      iterationCount: 0,
      adaptiveStrategy: "CUSTOM adaptive tactics for this slice.",
    });
    expect(prompt).toContain("MISSION SAFETY CORE");
    expect(prompt).toContain("ADAPTIVE STRATEGY");
    expect(prompt).toContain("CUSTOM adaptive tactics for this slice.");
    expect(findMissingSafetyMarkers(prompt)).toEqual([]);
  });

  it("falls back to the baseline adaptive when none is supplied", () => {
    const prompt = buildMissionRunPrompt(ctx, {
      missionPromptContext: "Grow bankroll",
      iterationCount: 0,
    });
    expect(prompt).toContain("ADAPTIVE STRATEGY");
    expect(prompt).toContain("Discovery:");
    expect(findMissingSafetyMarkers(prompt)).toEqual([]);
  });
});
