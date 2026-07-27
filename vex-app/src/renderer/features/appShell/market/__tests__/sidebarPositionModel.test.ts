import { describe, expect, it } from "vitest";
import { sumTokenAmountBySymbol } from "../sidebarPositionModel.js";

describe("sumTokenAmountBySymbol", () => {
  it("sums matching-symbol amounts case-insensitively across rows", () => {
    const total = sumTokenAmountBySymbol(
      [
        { symbol: "ETH", amount: 0.5 },
        { symbol: "eth", amount: 0.25 },
        { symbol: "USDC", amount: 100 },
      ],
      "ETH",
    );
    expect(total).toBeCloseTo(0.75, 8);
  });

  it("returns null when no matching row exists (never a fabricated 0)", () => {
    expect(
      sumTokenAmountBySymbol([{ symbol: "USDC", amount: 100 }], "ETH"),
    ).toBeNull();
  });

  it("ignores rows with null/non-finite amount or null symbol", () => {
    expect(
      sumTokenAmountBySymbol(
        [
          { symbol: null, amount: 1 },
          { symbol: "ETH", amount: null },
          { symbol: "ETH", amount: Number.NaN },
        ],
        "ETH",
      ),
    ).toBeNull();
  });

  it("counts a genuine zero-amount ETH row as matched (returns 0, not null)", () => {
    expect(
      sumTokenAmountBySymbol([{ symbol: "ETH", amount: 0 }], "ETH"),
    ).toBe(0);
  });
});
