/**
 * Pure derivation tests for the post-mission summary card. Locks the signed ETH
 * headline, the optional percent parenthetical, the trades/settlement meta line,
 * the USD tooltip, and the sign-based PnL tone.
 */

import { describe, expect, it } from "vitest";
import { EM_DASH } from "../missionHistoryModel.js";
import {
  formatMetaLine,
  formatPnlEth,
  formatPnlPct,
  formatSettlement,
  pnlToneClass,
  pnlUsdTitle,
} from "../missionSummaryModel.js";

describe("formatPnlEth", () => {
  it("signs the ETH figure and appends the unit", () => {
    expect(formatPnlEth(0.0012)).toBe("+0.0012 ETH");
    expect(formatPnlEth(-0.0034)).toBe("-0.0034 ETH");
    expect(formatPnlEth(0)).toBe("+0.0000 ETH");
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

describe("pnlUsdTitle", () => {
  it("formats the closing USD value with a caption", () => {
    expect(pnlUsdTitle(0.01, 3000)).toBe("$30.00 at close");
  });

  it("is undefined when either input is missing", () => {
    expect(pnlUsdTitle(null, 3000)).toBeUndefined();
    expect(pnlUsdTitle(0.01, null)).toBeUndefined();
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
