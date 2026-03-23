import { describe, it, expect } from "vitest";
import {
  validatePositionsResponse, validateClosedPositionsResponse,
  validateActivityResponse, validateTradesResponse,
  validateHoldersResponse, validateLeaderboardResponse,
  validateValueResponse, validateTradedResponse,
  validateOpenInterestResponse, validateMarketPositionsResponse,
} from "../polymarket/data/validation.js";

describe("validatePositionsResponse", () => {
  it("parses positions", () => {
    const r = validatePositionsResponse([{ proxyWallet: "0x1", asset: "t", conditionId: "0xc", size: 100, avgPrice: 0.5, currentValue: 60, cashPnl: 10, percentPnl: 0.2, curPrice: 0.6, redeemable: false, mergeable: false, outcomeIndex: 0 }]);
    expect(r).toHaveLength(1);
    expect(r[0].size).toBe(100);
    expect(r[0].cashPnl).toBe(10);
  });
  it("throws for non-array", () => { expect(() => validatePositionsResponse(null)).toThrow(); });
});

describe("validateClosedPositionsResponse", () => {
  it("parses closed positions", () => {
    const r = validateClosedPositionsResponse([{ proxyWallet: "0x1", asset: "t", conditionId: "0xc", realizedPnl: 25, timestamp: 123 }]);
    expect(r[0].realizedPnl).toBe(25);
  });
});

describe("validateActivityResponse", () => {
  it("parses activity", () => {
    const r = validateActivityResponse([{ proxyWallet: "0x1", timestamp: 123, conditionId: "0xc", type: "TRADE", size: 10, usdcSize: 5, price: 0.5, asset: "t", side: "BUY", outcomeIndex: 0 }]);
    expect(r[0].type).toBe("TRADE");
    expect(r[0].side).toBe("BUY");
  });
  it("handles null side", () => {
    const r = validateActivityResponse([{ proxyWallet: "0x1", timestamp: 123, conditionId: "0xc", type: "REDEEM", size: 10, usdcSize: 5, price: 1, asset: "t", outcomeIndex: 0 }]);
    expect(r[0].side).toBeNull();
  });
});

describe("validateTradesResponse", () => {
  it("parses trades", () => {
    const r = validateTradesResponse([{ proxyWallet: "0x1", side: "SELL", asset: "t", conditionId: "0xc", size: 50, price: 0.7, timestamp: 123, outcomeIndex: 1 }]);
    expect(r[0].side).toBe("SELL");
  });
});

describe("validateHoldersResponse", () => {
  it("parses nested holders", () => {
    const r = validateHoldersResponse([{
      token: "tok1",
      holders: [{ proxyWallet: "0x1", amount: 1000, outcomeIndex: 0, displayUsernamePublic: true, name: "Whale" }],
    }]);
    expect(r[0].holders).toHaveLength(1);
    expect(r[0].holders[0].amount).toBe(1000);
  });
});

describe("validateLeaderboardResponse", () => {
  it("parses leaderboard", () => {
    const r = validateLeaderboardResponse([{ rank: "1", proxyWallet: "0x1", userName: "TopTrader", vol: 1000000, pnl: 50000, verifiedBadge: true }]);
    expect(r[0].rank).toBe("1");
    expect(r[0].pnl).toBe(50000);
  });
});

describe("validateValueResponse", () => {
  it("parses from array", () => {
    const r = validateValueResponse([{ user: "0x1", value: 5000 }]);
    expect(r.value).toBe(5000);
  });
  it("parses from object", () => {
    const r = validateValueResponse({ user: "0x1", value: 3000 });
    expect(r.value).toBe(3000);
  });
});

describe("validateTradedResponse", () => {
  it("parses traded count", () => {
    const r = validateTradedResponse({ user: "0x1", traded: 42 });
    expect(r.traded).toBe(42);
  });
});

describe("validateOpenInterestResponse", () => {
  it("parses OI", () => {
    const r = validateOpenInterestResponse([{ market: "0xabc", value: 100000 }]);
    expect(r[0].value).toBe(100000);
  });
});

describe("validateMarketPositionsResponse", () => {
  it("parses meta positions", () => {
    const r = validateMarketPositionsResponse([{
      token: "tok1",
      positions: [{ proxyWallet: "0x1", size: 500, cashPnl: 100, totalPnl: 150, outcome: "YES", outcomeIndex: 0 }],
    }]);
    expect(r[0].positions[0].totalPnl).toBe(150);
  });
});
