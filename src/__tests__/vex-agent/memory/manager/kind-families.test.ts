/**
 * Kind-family classifier unit tests — generalization (D-REC gate) + trade
 * (process-vs-outcome) family membership.
 */

import { describe, it, expect } from "vitest";

import { isGeneralizationKind, isTradeKind } from "@vex-agent/memory/manager/kind-families.js";

describe("isGeneralizationKind", () => {
  it("classifies strategy / risk / lesson / pattern kinds as generalizations", () => {
    expect(isGeneralizationKind("strategy_lesson")).toBe(true);
    expect(isGeneralizationKind("risk_lesson")).toBe(true);
    expect(isGeneralizationKind("entry_pattern")).toBe(true);
    expect(isGeneralizationKind("trading_heuristic")).toBe(true);
  });

  it("does NOT classify a single anchored fact or preference as a generalization", () => {
    expect(isGeneralizationKind("token_fact")).toBe(false);
    expect(isGeneralizationKind("user_preference")).toBe(false);
    expect(isGeneralizationKind("wallet_note")).toBe(false);
  });
});

describe("isTradeKind", () => {
  it("classifies trade-family kinds where process-vs-outcome applies", () => {
    expect(isTradeKind("trade_outcome")).toBe(true);
    expect(isTradeKind("strategy_lesson")).toBe(true);
    expect(isTradeKind("position_sizing")).toBe(true);
  });

  it("does NOT classify a non-trade fact", () => {
    expect(isTradeKind("user_preference")).toBe(false);
    expect(isTradeKind("protocol_note")).toBe(false);
  });
});
