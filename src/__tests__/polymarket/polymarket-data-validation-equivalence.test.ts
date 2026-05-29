/**
 * codex-002 Phase 2 — behavior-preservation (equivalence) tests for the Zod
 * rewrite of `src/tools/polymarket/data/validation.ts`.
 *
 * The Data API validators are LENIENT-DEFAULTING at the field level (every
 * field falls back to a safe default rather than rejecting) but MIXED at the
 * root: list validators throw a plain `Error` on a non-array root; builder /
 * open-interest map element defaults (open-interest still throws on a non-array
 * root, builder validators return `[]`); live-volume / value / traded never
 * throw and return a scalar default. This file pins the NEW implementation
 * against an inline ORACLE that reproduces the ORIGINAL hand-written logic over
 * a battery of inputs: fully-valid, partial / missing (each default asserted),
 * wrong-typed, arrays with bad elements (element-default vs throw), and
 * non-array / non-record roots. Numeric fields are probed with ±Infinity
 * (ACCEPTED — proves `z.number()` was not used) and NaN (rejected by `num`,
 * accepted by the loose `typeof === "number"` fields).
 */

import { describe, it, expect } from "vitest";
import {
  validatePositionsResponse, validateClosedPositionsResponse,
  validateActivityResponse, validateTradesResponse,
  validateHoldersResponse, validateOpenInterestResponse,
  validateLiveVolumeResponse, validateLeaderboardResponse,
  validateBuilderLeaderboardResponse, validateBuilderVolumeResponse,
  validateValueResponse, validateTradedResponse,
  validateMarketPositionsResponse,
} from "@tools/polymarket/data/validation.js";

// ── ORACLE: verbatim reproduction of the ORIGINAL hand-written logic ───

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oAsOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function num(v: unknown, def = 0): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : def;
}
function str(v: unknown, def = ""): string {
  return typeof v === "string" ? v : def;
}

function oPositions(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("position must be an object");
    return {
      proxyWallet: str(r.proxyWallet), asset: str(r.asset), conditionId: str(r.conditionId),
      size: num(r.size), avgPrice: num(r.avgPrice), initialValue: num(r.initialValue),
      currentValue: num(r.currentValue), cashPnl: num(r.cashPnl), percentPnl: num(r.percentPnl),
      totalBought: num(r.totalBought), realizedPnl: num(r.realizedPnl), curPrice: num(r.curPrice),
      redeemable: r.redeemable === true, mergeable: r.mergeable === true,
      title: oAsOptionalString(r.title) ?? null, slug: oAsOptionalString(r.slug) ?? null,
      eventSlug: oAsOptionalString(r.eventSlug) ?? null, outcome: oAsOptionalString(r.outcome) ?? null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      endDate: oAsOptionalString(r.endDate) ?? null, negativeRisk: r.negativeRisk === true,
    };
  });
}
function oClosed(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected closed positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("closed position must be an object");
    return {
      proxyWallet: str(r.proxyWallet), asset: str(r.asset), conditionId: str(r.conditionId),
      avgPrice: num(r.avgPrice), totalBought: num(r.totalBought), realizedPnl: num(r.realizedPnl),
      curPrice: num(r.curPrice), timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
      title: oAsOptionalString(r.title) ?? null, slug: oAsOptionalString(r.slug) ?? null,
      eventSlug: oAsOptionalString(r.eventSlug) ?? null, outcome: oAsOptionalString(r.outcome) ?? null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      endDate: oAsOptionalString(r.endDate) ?? null,
    };
  });
}
function oActivity(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected activity array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("activity must be an object");
    return {
      proxyWallet: str(r.proxyWallet), timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
      conditionId: str(r.conditionId), type: str(r.type, "TRADE"),
      size: num(r.size), usdcSize: num(r.usdcSize), price: num(r.price), asset: str(r.asset),
      side: r.side === "BUY" || r.side === "SELL" ? r.side : null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      title: oAsOptionalString(r.title) ?? null, slug: oAsOptionalString(r.slug) ?? null,
      outcome: oAsOptionalString(r.outcome) ?? null, transactionHash: oAsOptionalString(r.transactionHash) ?? null,
    };
  });
}
function oTrades(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected trades array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("trade must be an object");
    return {
      proxyWallet: str(r.proxyWallet), side: r.side === "SELL" ? "SELL" : "BUY",
      asset: str(r.asset), conditionId: str(r.conditionId), size: num(r.size), price: num(r.price),
      timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
      title: oAsOptionalString(r.title) ?? null, slug: oAsOptionalString(r.slug) ?? null,
      outcome: oAsOptionalString(r.outcome) ?? null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      transactionHash: oAsOptionalString(r.transactionHash) ?? null,
      name: oAsOptionalString(r.name) ?? null, pseudonym: oAsOptionalString(r.pseudonym) ?? null,
      profileImage: oAsOptionalString(r.profileImage) ?? null,
    };
  });
}
function oHolders(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected holders array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("meta holder must be an object");
    return {
      token: str(r.token),
      holders: Array.isArray(r.holders) ? r.holders.map((h: unknown) => {
        if (!isRecord(h)) return { proxyWallet: "", bio: null, asset: "", pseudonym: null, amount: 0, displayUsernamePublic: false, outcomeIndex: 0, name: null, profileImage: null };
        return {
          proxyWallet: str(h.proxyWallet), bio: oAsOptionalString(h.bio) ?? null, asset: str(h.asset),
          pseudonym: oAsOptionalString(h.pseudonym) ?? null, amount: num(h.amount),
          displayUsernamePublic: h.displayUsernamePublic === true,
          outcomeIndex: typeof h.outcomeIndex === "number" ? h.outcomeIndex : 0,
          name: oAsOptionalString(h.name) ?? null, profileImage: oAsOptionalString(h.profileImage) ?? null,
        };
      }) : [],
    };
  });
}
function oOpenInterest(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected OI array");
  return raw.map((r) => {
    if (!isRecord(r)) return { market: "", value: 0 };
    return { market: str(r.market), value: num(r.value) };
  });
}
function oLiveVolume(raw: unknown) {
  if (!Array.isArray(raw) || !isRecord(raw[0])) return { total: 0, markets: [] };
  const r = raw[0];
  return {
    total: num(r.total),
    markets: Array.isArray(r.markets) ? r.markets.map((m: unknown) => {
      if (!isRecord(m)) return { market: "", value: 0 };
      return { market: str(m.market), value: num(m.value) };
    }) : [],
  };
}
function oLeaderboard(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected leaderboard array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("leaderboard entry must be an object");
    return {
      rank: str(r.rank), proxyWallet: str(r.proxyWallet), userName: oAsOptionalString(r.userName) ?? null,
      vol: num(r.vol), pnl: num(r.pnl), profileImage: oAsOptionalString(r.profileImage) ?? null,
      xUsername: oAsOptionalString(r.xUsername) ?? null, verifiedBadge: r.verifiedBadge === true,
    };
  });
}
function oBuilderLeaderboard(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (!isRecord(r)) return { rank: "", builder: "", volume: 0, activeUsers: 0, verified: false, builderLogo: null };
    return {
      rank: str(r.rank), builder: str(r.builder), volume: num(r.volume),
      activeUsers: typeof r.activeUsers === "number" ? r.activeUsers : 0,
      verified: r.verified === true, builderLogo: oAsOptionalString(r.builderLogo) ?? null,
    };
  });
}
function oBuilderVolume(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (!isRecord(r)) return { dt: "", builder: "", builderLogo: null, verified: false, volume: 0, activeUsers: 0, rank: "" };
    return {
      dt: str(r.dt), builder: str(r.builder), builderLogo: oAsOptionalString(r.builderLogo) ?? null,
      verified: r.verified === true, volume: num(r.volume),
      activeUsers: typeof r.activeUsers === "number" ? r.activeUsers : 0, rank: str(r.rank),
    };
  });
}
function oValue(raw: unknown) {
  if (Array.isArray(raw) && isRecord(raw[0])) return { user: str(raw[0].user), value: num(raw[0].value) };
  if (isRecord(raw)) return { user: str(raw.user), value: num(raw.value) };
  return { user: "", value: 0 };
}
function oTraded(raw: unknown) {
  if (isRecord(raw)) return { user: str(raw.user), traded: typeof raw.traded === "number" ? raw.traded : 0 };
  return { user: "", traded: 0 };
}
function oMarketPositions(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected market positions array");
  return raw.map((r) => {
    if (!isRecord(r)) return { token: "", positions: [] };
    return {
      token: str(r.token),
      positions: Array.isArray(r.positions) ? r.positions.map((p: unknown) => {
        if (!isRecord(p)) return { proxyWallet: "", name: null, profileImage: null, verified: false, asset: "", conditionId: "", avgPrice: 0, size: 0, currPrice: 0, currentValue: 0, cashPnl: 0, totalBought: 0, realizedPnl: 0, totalPnl: 0, outcome: null, outcomeIndex: 0 };
        return {
          proxyWallet: str(p.proxyWallet), name: oAsOptionalString(p.name) ?? null,
          profileImage: oAsOptionalString(p.profileImage) ?? null, verified: p.verified === true,
          asset: str(p.asset), conditionId: str(p.conditionId), avgPrice: num(p.avgPrice),
          size: num(p.size), currPrice: num(p.currPrice), currentValue: num(p.currentValue),
          cashPnl: num(p.cashPnl), totalBought: num(p.totalBought), realizedPnl: num(p.realizedPnl),
          totalPnl: num(p.totalPnl), outcome: oAsOptionalString(p.outcome) ?? null,
          outcomeIndex: typeof p.outcomeIndex === "number" ? p.outcomeIndex : 0,
        };
      }) : [],
    };
  });
}

// ── Root batteries ─────────────────────────────────────────────────────
const nonArrayRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null], ["undefined", undefined], ["number", 42], ["string", "bad"],
  ["boolean", true], ["object", { a: 1 }],
];
const nonRecordRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null], ["undefined", undefined], ["number", 42], ["string", "bad"],
  ["boolean", true], ["array", [1, 2, 3]],
];

// ── positions ──────────────────────────────────────────────────────────

describe("validatePositionsResponse — equivalence", () => {
  const full = [{
    proxyWallet: "0x1", asset: "t", conditionId: "0xc", size: 100, avgPrice: 0.5,
    initialValue: 50, currentValue: 60, cashPnl: 10, percentPnl: 0.2, totalBought: 50,
    realizedPnl: 5, curPrice: 0.6, redeemable: true, mergeable: false, title: "T", slug: "s",
    eventSlug: "es", outcome: "YES", outcomeIndex: 1, endDate: "2025", negativeRisk: true, extra: "stripped",
  }];
  it.each([
    ["full (extra key stripped)", full],
    ["partial -> defaults", [{ proxyWallet: "0x1" }]],
    ["wrong-typed -> defaults", [{ size: "x", redeemable: "true", title: 5, outcomeIndex: "n" }]],
    ["empty array", []],
  ])("matches oracle: %s", (_l, input) => {
    expect(validatePositionsResponse(input)).toEqual(oPositions(input));
  });

  it("lands exact defaults on a fully-empty record", () => {
    const r = validatePositionsResponse([{}]);
    expect(r[0]).toEqual({
      proxyWallet: "", asset: "", conditionId: "", size: 0, avgPrice: 0, initialValue: 0,
      currentValue: 0, cashPnl: 0, percentPnl: 0, totalBought: 0, realizedPnl: 0, curPrice: 0,
      redeemable: false, mergeable: false, title: null, slug: null, eventSlug: null,
      outcome: null, outcomeIndex: 0, endDate: null, negativeRisk: false,
    });
  });

  it("accepts ±Infinity on numeric (num) fields", () => {
    const r = validatePositionsResponse([{ size: Infinity, curPrice: -Infinity }]);
    expect(r[0].size).toBe(Infinity);
    expect(r[0].curPrice).toBe(-Infinity);
  });

  it("rejects NaN on num fields (-> default 0) but keeps NaN on loose outcomeIndex", () => {
    const r = validatePositionsResponse([{ size: NaN, outcomeIndex: NaN }]);
    expect(r[0].size).toBe(0); // num() rejects NaN
    expect(Number.isNaN(r[0].outcomeIndex)).toBe(true); // loose typeof keeps NaN
  });

  it("empty-string string fields are kept by str() but null'd by asOptionalString", () => {
    const r = validatePositionsResponse([{ proxyWallet: "", title: "" }]);
    expect(r[0].proxyWallet).toBe(""); // str keeps empty
    expect(r[0].title).toBeNull(); // asOptionalString -> undefined -> null
  });

  it.each(nonArrayRoots)("throws plain Error on non-array root: %s", (_l, root) => {
    expect(() => validatePositionsResponse(root)).toThrowError(new Error("Expected positions array"));
  });

  it("throws 'position must be an object' on a non-record element", () => {
    expect(() => validatePositionsResponse([null])).toThrowError(new Error("position must be an object"));
    expect(() => oPositions([null])).toThrowError(new Error("position must be an object"));
  });
});

// ── closed positions ────────────────────────────────────────────────────

describe("validateClosedPositionsResponse — equivalence", () => {
  it.each([
    ["full", [{ proxyWallet: "0x1", asset: "t", conditionId: "0xc", avgPrice: 0.5, totalBought: 5, realizedPnl: 25, curPrice: 0.6, timestamp: 123, outcomeIndex: 0, title: "T" }]],
    ["partial", [{ realizedPnl: 25 }]],
    ["wrong-typed", [{ avgPrice: "x", timestamp: "t" }]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateClosedPositionsResponse(input)).toEqual(oClosed(input));
  });
  it("accepts Infinity on avgPrice, rejects NaN, keeps NaN timestamp", () => {
    const r = validateClosedPositionsResponse([{ avgPrice: Infinity, realizedPnl: NaN, timestamp: NaN }]);
    expect(r[0].avgPrice).toBe(Infinity);
    expect(r[0].realizedPnl).toBe(0);
    expect(Number.isNaN(r[0].timestamp)).toBe(true);
  });
  it.each(nonArrayRoots)("throws on non-array root: %s", (_l, root) => {
    expect(() => validateClosedPositionsResponse(root)).toThrowError(new Error("Expected closed positions array"));
  });
  it("throws on non-record element", () => {
    expect(() => validateClosedPositionsResponse([5])).toThrowError(new Error("closed position must be an object"));
  });
});

// ── activity ────────────────────────────────────────────────────────────

describe("validateActivityResponse — equivalence", () => {
  it.each([
    ["BUY side", [{ proxyWallet: "0x1", timestamp: 1, conditionId: "0xc", type: "TRADE", size: 10, usdcSize: 5, price: 0.5, asset: "t", side: "BUY", outcomeIndex: 0 }]],
    ["SELL side", [{ side: "SELL", type: "MERGE" }]],
    ["bad side -> null", [{ side: "weird", type: "REDEEM" }]],
    ["missing type -> TRADE", [{}]],
    ["arbitrary type string passes through (cast)", [{ type: "WHATEVER" }]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateActivityResponse(input)).toEqual(oActivity(input));
  });
  it("accepts Infinity on price (num)", () => {
    expect(validateActivityResponse([{ price: Infinity }])[0].price).toBe(Infinity);
  });
  it.each(nonArrayRoots)("throws on non-array root: %s", (_l, root) => {
    expect(() => validateActivityResponse(root)).toThrowError(new Error("Expected activity array"));
  });
  it("throws on non-record element", () => {
    expect(() => validateActivityResponse(["x"])).toThrowError(new Error("activity must be an object"));
  });
});

// ── trades ──────────────────────────────────────────────────────────────

describe("validateTradesResponse — equivalence", () => {
  it.each([
    ["SELL", [{ side: "SELL", size: 50, price: 0.7 }]],
    ["non-SELL -> BUY", [{ side: "BUY" }]],
    ["missing side -> BUY", [{}]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateTradesResponse(input)).toEqual(oTrades(input));
  });
  it.each(nonArrayRoots)("throws on non-array root: %s", (_l, root) => {
    expect(() => validateTradesResponse(root)).toThrowError(new Error("Expected trades array"));
  });
  it("throws on non-record element", () => {
    expect(() => validateTradesResponse([0])).toThrowError(new Error("trade must be an object"));
  });
});

// ── holders ─────────────────────────────────────────────────────────────

describe("validateHoldersResponse — equivalence", () => {
  it.each([
    ["nested holders incl. non-record element default", [{ token: "tok1", holders: [{ proxyWallet: "0x1", amount: 1000, outcomeIndex: 0, displayUsernamePublic: true, name: "Whale" }, null, "junk"] }]],
    ["non-array holders -> []", [{ token: "tok1", holders: "x" }]],
    ["missing holders -> []", [{ token: "tok1" }]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateHoldersResponse(input)).toEqual(oHolders(input));
  });
  it("accepts Infinity amount", () => {
    expect(validateHoldersResponse([{ holders: [{ amount: Infinity }] }])[0].holders[0].amount).toBe(Infinity);
  });
  it.each(nonArrayRoots)("throws on non-array root: %s", (_l, root) => {
    expect(() => validateHoldersResponse(root)).toThrowError(new Error("Expected holders array"));
  });
  it("throws on non-record outer element", () => {
    expect(() => validateHoldersResponse([1])).toThrowError(new Error("meta holder must be an object"));
  });
});

// ── open interest ───────────────────────────────────────────────────────

describe("validateOpenInterestResponse — equivalence", () => {
  it.each([
    ["valid", [{ market: "0xabc", value: 100000 }]],
    ["non-record element -> default", [null, { market: "m", value: 5 }, "junk"]],
    ["empty", []],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateOpenInterestResponse(input)).toEqual(oOpenInterest(input));
  });
  it("accepts Infinity, rejects NaN -> 0", () => {
    expect(validateOpenInterestResponse([{ value: Infinity }])[0].value).toBe(Infinity);
    expect(validateOpenInterestResponse([{ value: NaN }])[0].value).toBe(0);
  });
  it.each(nonArrayRoots)("throws plain Error on non-array root: %s", (_l, root) => {
    expect(() => validateOpenInterestResponse(root)).toThrowError(new Error("Expected OI array"));
  });
});

// ── live volume (never throws) ──────────────────────────────────────────

describe("validateLiveVolumeResponse — equivalence (never throws)", () => {
  it.each([
    ["valid first element", [{ total: 999, markets: [{ market: "m", value: 5 }, null] }]],
    ["non-array markets -> []", [{ total: 1, markets: "x" }]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateLiveVolumeResponse(input)).toEqual(oLiveVolume(input));
  });
  it("accepts Infinity total", () => {
    expect(validateLiveVolumeResponse([{ total: Infinity }]).total).toBe(Infinity);
  });
  it.each(nonArrayRoots)("returns {total:0,markets:[]} on bad root: %s", (_l, root) => {
    expect(validateLiveVolumeResponse(root)).toEqual({ total: 0, markets: [] });
    expect(oLiveVolume(root)).toEqual({ total: 0, markets: [] });
  });
  it("non-record first element -> default", () => {
    expect(validateLiveVolumeResponse([5])).toEqual({ total: 0, markets: [] });
  });
});

// ── leaderboard ─────────────────────────────────────────────────────────

describe("validateLeaderboardResponse — equivalence", () => {
  it.each([
    ["valid", [{ rank: "1", proxyWallet: "0x1", userName: "Top", vol: 1e6, pnl: 5e4, verifiedBadge: true }]],
    ["partial", [{ rank: "2" }]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateLeaderboardResponse(input)).toEqual(oLeaderboard(input));
  });
  it("accepts Infinity vol", () => {
    expect(validateLeaderboardResponse([{ vol: Infinity }])[0].vol).toBe(Infinity);
  });
  it.each(nonArrayRoots)("throws on non-array root: %s", (_l, root) => {
    expect(() => validateLeaderboardResponse(root)).toThrowError(new Error("Expected leaderboard array"));
  });
  it("throws on non-record element", () => {
    expect(() => validateLeaderboardResponse([true])).toThrowError(new Error("leaderboard entry must be an object"));
  });
});

// ── builder leaderboard (never throws) ──────────────────────────────────

describe("validateBuilderLeaderboardResponse — equivalence (never throws)", () => {
  it.each([
    ["valid", [{ rank: "1", builder: "b", volume: 100, activeUsers: 10, verified: true, builderLogo: "l" }]],
    ["non-record element -> default", ["junk", null, { builder: "b" }]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateBuilderLeaderboardResponse(input)).toEqual(oBuilderLeaderboard(input));
  });
  it("keeps NaN activeUsers (loose), accepts Infinity volume, rejects NaN volume", () => {
    const r = validateBuilderLeaderboardResponse([{ activeUsers: NaN, volume: NaN }, { volume: Infinity }]);
    expect(Number.isNaN(r[0].activeUsers)).toBe(true);
    expect(r[0].volume).toBe(0); // num rejects NaN
    expect(r[1].volume).toBe(Infinity);
  });
  it.each(nonArrayRoots)("returns [] (no throw) on bad root: %s", (_l, root) => {
    expect(validateBuilderLeaderboardResponse(root)).toEqual([]);
  });
});

// ── builder volume (never throws) ───────────────────────────────────────

describe("validateBuilderVolumeResponse — equivalence (never throws)", () => {
  it.each([
    ["valid", [{ dt: "2025-01-01T00:00:00Z", builder: "builder1", builderLogo: "https://logo.png", verified: true, volume: 50000, activeUsers: 100, rank: "1" }]],
    ["partial", [{ dt: "2025-01-01", builder: "b" }]],
    ["non-record element -> default", [42]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateBuilderVolumeResponse(input)).toEqual(oBuilderVolume(input));
  });
  it.each(nonArrayRoots)("returns [] (no throw) on bad root: %s", (_l, root) => {
    expect(validateBuilderVolumeResponse(root)).toEqual([]);
  });
});

// ── value / traded scalars (never throw) ────────────────────────────────

describe("validateValueResponse — equivalence (never throws)", () => {
  it.each([
    ["from array", [{ user: "0x1", value: 5000 }]],
    ["from object", { user: "0x1", value: 3000 }],
    ["array with non-record first -> object branch skipped -> default", [5]],
    ["wrong-typed value -> 0", { user: 1, value: "x" }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateValueResponse(input)).toEqual(oValue(input));
  });
  it("accepts Infinity value", () => {
    expect(validateValueResponse({ value: Infinity }).value).toBe(Infinity);
  });
  it.each(nonRecordRoots.filter(([l]) => l !== "array"))("returns {user:'',value:0} on bad root: %s", (_l, root) => {
    expect(validateValueResponse(root)).toEqual({ user: "", value: 0 });
  });
  it("array of non-records -> default", () => {
    expect(validateValueResponse([1, 2])).toEqual({ user: "", value: 0 });
  });
});

describe("validateTradedResponse — equivalence (never throws)", () => {
  it.each([
    ["valid", { user: "0x1", traded: 42 }],
    ["missing traded -> 0", { user: "0x1" }],
    ["keeps NaN (loose)", { traded: NaN }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateTradedResponse(input)).toEqual(oTraded(input));
  });
  it("keeps NaN traded (loose typeof)", () => {
    expect(Number.isNaN(validateTradedResponse({ traded: NaN }).traded)).toBe(true);
  });
  it.each(nonRecordRoots)("returns {user:'',traded:0} on bad root: %s", (_l, root) => {
    expect(validateTradedResponse(root)).toEqual({ user: "", traded: 0 });
  });
});

// ── market positions (throws on non-array root; element default) ────────

describe("validateMarketPositionsResponse — equivalence", () => {
  it.each([
    ["nested positions", [{ token: "tok1", positions: [{ proxyWallet: "0x1", size: 500, cashPnl: 100, totalPnl: 150, outcome: "YES", outcomeIndex: 0 }] }]],
    ["non-record position element -> default", [{ token: "t", positions: [null, "junk"] }]],
    ["non-array positions -> []", [{ token: "t", positions: 5 }]],
    ["non-record outer element -> {token:'',positions:[]}", [null]],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateMarketPositionsResponse(input)).toEqual(oMarketPositions(input));
  });
  it("accepts Infinity on avgPrice, rejects NaN, keeps NaN outcomeIndex", () => {
    const r = validateMarketPositionsResponse([{ positions: [{ avgPrice: Infinity, size: NaN, outcomeIndex: NaN }] }]);
    expect(r[0].positions[0].avgPrice).toBe(Infinity);
    expect(r[0].positions[0].size).toBe(0);
    expect(Number.isNaN(r[0].positions[0].outcomeIndex)).toBe(true);
  });
  it.each(nonArrayRoots)("throws plain Error on non-array root: %s", (_l, root) => {
    expect(() => validateMarketPositionsResponse(root)).toThrowError(new Error("Expected market positions array"));
  });
});
