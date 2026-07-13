/**
 * SIGNAL RADAR banner — pure formatter tests. Renders recent TrendRadar signals
 * into a turn-state prompt block the mission agent reads. No DB/network here.
 */

import { describe, it, expect } from "vitest";
import { renderSignalRadar } from "@vex-agent/engine/prompts/signal-radar-banner.js";
import type { SignalRow } from "@vex-agent/db/repos/signals.js";

function row(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    source: "trendradar", chain: "robinhood",
    contract: "0x39E0D9057BD9039Cd14590f54dE20B9D3457c56E", symbol: "NOXA",
    action: "TINY BUY", score: 100, todayMentions: 5, yesterdayMentions: 1,
    velocityPct: 700, liquidityUsd: 90670.58, volume24hUsd: 3130810.9,
    priceUsd: 0.01, narratives: ["Robinhood Chain"], riskFlags: [],
    ingestedAt: "2026-07-12T17:05:00Z", ...overrides,
  };
}

describe("renderSignalRadar", () => {
  it("returns empty string for no signals (section omitted)", () => {
    expect(renderSignalRadar([])).toBe("");
  });

  it("renders a header and a strong guardrail that these are leads, not buy orders", () => {
    const out = renderSignalRadar([row()]);
    expect(out).toContain("SIGNAL RADAR");
    expect(out.toLowerCase()).toContain("leads");
    // Must tell the agent to still apply constraints + confirm a sell route.
    expect(out.toLowerCase()).toContain("sell route");
  });

  it("includes the full contract address (agent needs it for swap tools)", () => {
    expect(renderSignalRadar([row()])).toContain(
      "0x39E0D9057BD9039Cd14590f54dE20B9D3457c56E",
    );
  });

  it("renders symbol, score, and compact liquidity/volume", () => {
    const out = renderSignalRadar([row()]);
    expect(out).toContain("NOXA");
    expect(out).toContain("100"); // score
    expect(out).toContain("$90.7k"); // liquidity
    expect(out).toContain("$3.13M"); // 24h volume
  });

  it("surfaces risk flags inline when present", () => {
    const out = renderSignalRadar([
      row({ symbol: "WISHBONE", riskFlags: ["Contract recently deployed"] }),
    ]);
    expect(out).toContain("Contract recently deployed");
  });

  it("ranks numerically in the order given (already score-sorted upstream)", () => {
    const out = renderSignalRadar([
      row({ symbol: "AAA", score: 100 }),
      row({ symbol: "BBB", score: 80 }),
    ]);
    expect(out.indexOf("1.")).toBeLessThan(out.indexOf("2."));
    expect(out.indexOf("AAA")).toBeLessThan(out.indexOf("BBB"));
  });
});
