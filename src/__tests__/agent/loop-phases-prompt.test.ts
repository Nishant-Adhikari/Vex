import { describe, expect, it } from "vitest";
import { buildPhasePrompt } from "../../agent/prompts/loop-phases.js";
import type { LoopPhase } from "../../agent/types.js";

describe("loop-phases prompts", () => {
  const ACTIVE_PHASES: LoopPhase[] = ["sense", "assess", "decide", "execute", "verify", "journal"];

  it("returns non-empty template for each active phase", () => {
    for (const phase of ACTIVE_PHASES) {
      const prompt = buildPhasePrompt(phase);
      expect(prompt.length).toBeGreaterThan(10);
    }
  });

  it("returns empty for idle and sleep phases", () => {
    expect(buildPhasePrompt("idle")).toBe("");
    expect(buildPhasePrompt("sleep")).toBe("");
  });

  it("prepends previous phase output when provided", () => {
    const prompt = buildPhasePrompt("assess", "SOL is up 5%");
    expect(prompt).toContain("Previous phase output:");
    expect(prompt).toContain("SOL is up 5%");
    expect(prompt).toContain("[ECHO LOOP — ASSESS PHASE]");
  });

  it("does not prepend when no previous output", () => {
    const prompt = buildPhasePrompt("sense");
    expect(prompt).not.toContain("Previous phase output:");
    expect(prompt).toContain("[ECHO LOOP — SENSE PHASE]");
  });

  it("sense phase mentions portfolio and prices", () => {
    const prompt = buildPhasePrompt("sense");
    expect(prompt.toLowerCase()).toContain("portfolio");
    expect(prompt.toLowerCase()).toContain("price");
  });

  it("decide phase mentions [NO ACTION] marker", () => {
    const prompt = buildPhasePrompt("decide");
    expect(prompt).toContain("[NO ACTION]");
  });

  it("journal phase mentions trade_log and memory", () => {
    const prompt = buildPhasePrompt("journal");
    expect(prompt).toContain("trade_log");
    expect(prompt).toContain("memory");
  });
});
