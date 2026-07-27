/**
 * Pure derivation tests for the post-mission summary card. Locks the signed ETH
 * headline, the optional percent parenthetical, the trades/settlement meta line,
 * the USD tooltip, and the sign-based PnL tone.
 */

import { describe, expect, it } from "vitest";
import { EM_DASH } from "../missionHistoryModel.js";
import {
  deriveEndReason,
  formatBankrollRange,
  formatBankrollRangeUsd,
  formatMetaLine,
  formatPnlEth,
  formatPnlPct,
  formatPnlUsd,
  formatSettlement,
  formatSettlementSignal,
  friendlyStopReason,
  pnlToneClass,
  pnlUsdTitle,
} from "../missionSummaryModel.js";

describe("formatPnlEth", () => {
  it("signs a non-zero ETH figure and appends the unit", () => {
    expect(formatPnlEth(0.0012)).toBe("+0.0012 ETH");
    expect(formatPnlEth(-0.0034)).toBe("-0.0034 ETH");
    // Break-even shows no sign — a "+" on exactly zero reads as a tiny gain,
    // which misleads on a card built for non-technical clarity.
    expect(formatPnlEth(0)).toBe("0.0000 ETH");
  });

  it("renders a bare em dash for null / non-finite", () => {
    expect(formatPnlEth(null)).toBe(EM_DASH);
    expect(formatPnlEth(Number.NaN)).toBe(EM_DASH);
  });
});

describe("formatPnlPct", () => {
  it("wraps a signed percent in parentheses", () => {
    expect(formatPnlPct(1.2)).toBe("(+1.20%)");
    expect(formatPnlPct(-3.4)).toBe("(-3.40%)");
  });

  it("returns an empty string for null / non-finite", () => {
    expect(formatPnlPct(null)).toBe("");
    expect(formatPnlPct(Number.NaN)).toBe("");
  });
});

describe("formatSettlement", () => {
  it("reads flat when no bags are held", () => {
    expect(formatSettlement(0)).toBe("ended flat ✅");
  });

  it("pluralises held bags", () => {
    expect(formatSettlement(1)).toBe("1 bag held ⚠");
    expect(formatSettlement(3)).toBe("3 bags held ⚠");
  });
});

describe("formatMetaLine", () => {
  it("joins the trade count with the settlement clause", () => {
    expect(formatMetaLine(4, 0)).toBe("4 trades · ended flat ✅");
    expect(formatMetaLine(7, 2)).toBe("7 trades · 2 bags held ⚠");
  });
});

describe("formatSettlementSignal", () => {
  it("reads flat when no attributable bags remain", () => {
    expect(formatSettlementSignal(0)).toBe("flat");
  });

  it("counts held bags without pluralising or framing", () => {
    expect(formatSettlementSignal(1)).toBe("1 held");
    expect(formatSettlementSignal(3)).toBe("3 held");
  });
});

describe("formatBankrollRange", () => {
  it("renders the start→end ETH range", () => {
    expect(formatBankrollRange(0.0137, 0.0149)).toBe("0.0137 → 0.0149");
  });

  it("em-dashes each side independently when its snapshot is missing", () => {
    expect(formatBankrollRange(null, 0.0149)).toBe("— → 0.0149");
    expect(formatBankrollRange(0.0137, null)).toBe("0.0137 → —");
  });
});

describe("formatBankrollRangeUsd", () => {
  it("converts each side to USD at the close price", () => {
    expect(formatBankrollRangeUsd(0.01, 0.005, 2000)).toBe("$20.00 → $10.00");
  });

  it("em-dashes a side missing its snapshot, or both when price is absent", () => {
    expect(formatBankrollRangeUsd(null, 0.005, 2000)).toBe("— → $10.00");
    expect(formatBankrollRangeUsd(0.01, 0.005, null)).toBe("— → —");
  });
});

describe("formatPnlUsd", () => {
  it("renders a signed USD figure at close", () => {
    expect(formatPnlUsd(0.0012, 3000)).toBe("+$3.60");
    expect(formatPnlUsd(-0.001, 3000)).toBe("-$3.00");
  });

  it("em-dashes when either input is missing", () => {
    expect(formatPnlUsd(null, 3000)).toBe(EM_DASH);
    expect(formatPnlUsd(0.0012, null)).toBe(EM_DASH);
  });
});

describe("pnlUsdTitle", () => {
  it("formats the closing USD value with a caption", () => {
    expect(pnlUsdTitle(0.01, 3000)).toBe("$30.00 at close");
  });

  it("is undefined when either input is missing", () => {
    expect(pnlUsdTitle(null, 3000)).toBeUndefined();
    expect(pnlUsdTitle(0.01, null)).toBeUndefined();
  });
});

describe("friendlyStopReason", () => {
  it("maps the known terminal stop reasons to human phrases", () => {
    expect(friendlyStopReason("emergency_stop")).toBe("Emergency stop");
    expect(friendlyStopReason("deadline_reached")).toBe("Time box reached");
    expect(friendlyStopReason("token_budget_exhausted")).toBe(
      "Token budget spent",
    );
    expect(friendlyStopReason("system_error")).toBe("System error");
    expect(friendlyStopReason("max_loss_hit")).toBe("Max loss hit");
    expect(friendlyStopReason("user_stopped")).toBe("Stopped by you");
  });

  it("prettifies an unmapped-but-present reason (never fabricates, never drops)", () => {
    expect(friendlyStopReason("some_new_reason")).toBe("some new reason");
  });

  it("is null for a missing reason", () => {
    expect(friendlyStopReason(null)).toBeNull();
    expect(friendlyStopReason("")).toBeNull();
  });
});

describe("deriveEndReason", () => {
  it("surfaces the reason phrase + persisted summary on an abnormal end", () => {
    expect(
      deriveEndReason(
        "failed",
        "emergency_stop",
        "Halted after 3 consecutive tool errors.",
      ),
    ).toEqual({
      reason: "Emergency stop",
      summary: "Halted after 3 consecutive tool errors.",
    });
  });

  it("keeps a clean success card quiet (no reason line on completed)", () => {
    expect(deriveEndReason("completed", "goal_reached", "Goal reached")).toBeNull();
  });

  it("never surfaces a reason while the run is still running", () => {
    expect(deriveEndReason("running", null, null)).toBeNull();
  });

  it("fabricates nothing when neither reason nor summary was stored", () => {
    expect(deriveEndReason("failed", null, null)).toBeNull();
    expect(deriveEndReason("failed", null, "   ")).toBeNull();
  });

  it("shows the reason alone when no summary was persisted", () => {
    expect(deriveEndReason("failed", "system_error", null)).toEqual({
      reason: "System error",
      summary: null,
    });
  });

  it("shows the summary alone when the reason is missing", () => {
    expect(deriveEndReason("stopped", null, "Operator review required.")).toEqual({
      reason: null,
      summary: "Operator review required.",
    });
  });

  it("trims surrounding whitespace from the persisted summary", () => {
    expect(
      deriveEndReason("failed", "system_error", "  boom  ")?.summary,
    ).toBe("boom");
  });
});

describe("pnlToneClass", () => {
  it("colours by sign", () => {
    expect(pnlToneClass(0.5)).toBe("text-[var(--color-success)]");
    expect(pnlToneClass(-0.5)).toBe("text-destructive");
    expect(pnlToneClass(0)).toBe("text-[var(--vex-text-2)]");
  });

  it("is muted for null / non-finite", () => {
    expect(pnlToneClass(null)).toBe("text-[var(--vex-text-3)]");
    expect(pnlToneClass(Number.NaN)).toBe("text-[var(--vex-text-3)]");
  });
});
