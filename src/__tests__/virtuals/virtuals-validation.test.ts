import { describe, expect, it } from "vitest";
import {
  normalizeAgent,
  validateGeneses,
  validateVirtualDetail,
  validateVirtualsList,
} from "@tools/virtuals/validation.js";

describe("normalizeAgent (tolerant)", () => {
  it("returns null for a non-object", () => {
    expect(normalizeAgent(null)).toBeNull();
    expect(normalizeAgent("nope")).toBeNull();
    expect(normalizeAgent(42)).toBeNull();
  });

  it("normalizes missing/wrong-typed fields to null and defaults isVerified false", () => {
    const a = normalizeAgent({ id: 1 });
    expect(a?.id).toBe(1);
    expect(a?.name).toBeNull();
    expect(a?.mcapInVirtual).toBeNull();
    expect(a?.isVerified).toBe(false);
    expect(a?.socials).toEqual([]);
    expect(a?.tokenomics).toEqual([]);
  });

  it("rejects NaN / Infinity numeric metrics (finite-only)", () => {
    const a = normalizeAgent({ id: 1, mcapInVirtual: Infinity, holderCount: NaN, volume24h: 10 });
    expect(a?.mcapInVirtual).toBeNull();
    expect(a?.holderCount).toBeNull();
    expect(a?.volume24h).toBe(10);
  });

  it("extracts ONLY verified socials, attaching the verified link", () => {
    const a = normalizeAgent({
      id: 1,
      socials: {
        VERIFIED_USERNAMES: { TWITTER: "vex", TELEGRAM: "vexchat" },
        VERIFIED_LINKS: { TWITTER: "https://x.com/vex" },
        // an UNVERIFIED bucket must be ignored entirely
        LINKS: { WEBSITE: "https://evil.example" },
      },
    });
    expect(a?.socials).toEqual([
      { platform: "TWITTER", handle: "vex", url: "https://x.com/vex" },
      { platform: "TELEGRAM", handle: "vexchat", url: null },
    ]);
  });

  it("reads antiSniperTaxType out of launchInfo", () => {
    const a = normalizeAgent({ id: 1, launchInfo: { antiSniperTaxType: 2, launchMode: 0 } });
    expect(a?.launchInfo?.antiSniperTaxType).toBe(2);
  });
});

describe("validateVirtualDetail", () => {
  it("unwraps {data} and normalizes", () => {
    const a = validateVirtualDetail({ data: { id: 7, symbol: "VEX", chain: "ROBINHOOD" } });
    expect(a?.id).toBe(7);
    expect(a?.symbol).toBe("VEX");
  });
  it("returns null on a driftless / missing envelope", () => {
    expect(validateVirtualDetail({ nope: 1 })).toBeNull();
    expect(validateVirtualDetail(null)).toBeNull();
  });
});

describe("validateVirtualsList", () => {
  it("maps + filters non-object rows and reads pagination", () => {
    const res = validateVirtualsList({
      data: [{ id: 1 }, "garbage", { id: 2 }],
      meta: { pagination: { total: 646, page: 1, pageSize: 20, pageCount: 33 } },
    });
    expect(res.agents.map((a) => a.id)).toEqual([1, 2]);
    expect(res.pagination?.total).toBe(646);
  });

  it("degrades to empty when data is not an array", () => {
    expect(validateVirtualsList({ data: {} })).toEqual({ agents: [], pagination: null });
    expect(validateVirtualsList(42)).toEqual({ agents: [], pagination: null });
  });
});

describe("validateGeneses", () => {
  it("normalizes geneses and the nested agent", () => {
    const res = validateGeneses({
      data: [{ id: 8860, status: "FINALIZED", genesisId: "413", virtual: { id: 5, symbol: "GEN" } }],
      meta: { pagination: { total: 363 } },
    });
    expect(res.geneses[0].status).toBe("FINALIZED");
    expect(res.geneses[0].agent?.symbol).toBe("GEN");
    expect(res.pagination?.total).toBe(363);
  });

  it("degrades to empty on non-array data", () => {
    expect(validateGeneses({ data: null })).toEqual({ geneses: [], pagination: null });
  });
});
