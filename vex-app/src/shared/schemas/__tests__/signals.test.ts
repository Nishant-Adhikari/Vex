/**
 * Signals schema tests — the IPC-boundary DTO contracts. Covers the list-item
 * DTO (valid + strict rejection of unknown keys), the list input defaults, and
 * the grade verdict shape (valid + out-of-range/unknown-verdict rejection).
 */

import { describe, expect, it } from "vitest";
import {
  SIGNALS_LIST_TODAY_DEFAULT_LIMIT,
  signalGradeInputSchema,
  signalGradeResultSchema,
  signalListItemDtoSchema,
  signalsListTodayInputSchema,
} from "../signals.js";

const VALID_ITEM = {
  id: 12,
  source: "trendradar",
  chain: "solana",
  contract: "So11111111111111111111111111111111111111112",
  symbol: "WIF",
  action: "watch",
  score: 87,
  todayMentions: 140,
  yesterdayMentions: 40,
  velocityPct: 250,
  liquidityUsd: 1_200_000,
  volume24hUsd: 8_000_000,
  priceUsd: 2.31,
  priceChange24hPct: 18.4,
  marketCapUsd: 2_000_000_000,
  dexscreenerUrl: "https://dexscreener.com/solana/abc",
  narratives: ["dogs"],
  riskFlags: [],
  feedGeneratedAt: "2026-07-23T10:00:00.000Z",
  ingestedAt: "2026-07-23T10:05:00.000Z",
  grade: 72,
  gradeVerdict: "runner",
  gradeRationale: "Deep liquidity, strong mention momentum.",
  gradedAt: "2026-07-23T10:06:00.000Z",
} as const;

describe("signalListItemDtoSchema", () => {
  it("accepts a well-formed item and preserves nullable fields", () => {
    const parsed = signalListItemDtoSchema.parse({
      ...VALID_ITEM,
      symbol: null,
      score: null,
      dexscreenerUrl: null,
    });
    expect(parsed.symbol).toBeNull();
    expect(parsed.score).toBeNull();
    expect(parsed.dexscreenerUrl).toBeNull();
    expect(parsed.contract).toBe(VALID_ITEM.contract);
  });

  it("carries the persisted grade fields through the DTO", () => {
    const parsed = signalListItemDtoSchema.parse(VALID_ITEM);
    expect(parsed.grade).toBe(72);
    expect(parsed.gradeVerdict).toBe("runner");
    expect(parsed.gradedAt).toBe("2026-07-23T10:06:00.000Z");
  });

  it("accepts an ungraded item (all grade fields null)", () => {
    const parsed = signalListItemDtoSchema.parse({
      ...VALID_ITEM,
      grade: null,
      gradeVerdict: null,
      gradeRationale: null,
      gradedAt: null,
    });
    expect(parsed.grade).toBeNull();
    expect(parsed.gradeVerdict).toBeNull();
  });

  it("rejects an unknown persisted verdict", () => {
    expect(
      signalListItemDtoSchema.safeParse({ ...VALID_ITEM, gradeVerdict: "moon" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict) so raw provider jsonb cannot leak", () => {
    const res = signalListItemDtoSchema.safeParse({
      ...VALID_ITEM,
      raw: { secret: "leak" },
    });
    expect(res.success).toBe(false);
  });

  it("rejects a non-positive id", () => {
    expect(signalListItemDtoSchema.safeParse({ ...VALID_ITEM, id: 0 }).success).toBe(
      false,
    );
  });
});

describe("signalsListTodayInputSchema", () => {
  it("applies window + limit defaults", () => {
    const parsed = signalsListTodayInputSchema.parse({});
    expect(parsed.withinHours).toBe(24);
    expect(parsed.limit).toBe(SIGNALS_LIST_TODAY_DEFAULT_LIMIT);
  });

  it("rejects a limit over the cap", () => {
    expect(signalsListTodayInputSchema.safeParse({ limit: 5_000 }).success).toBe(
      false,
    );
  });
});

describe("signalGradeInputSchema", () => {
  it("requires a positive integer id", () => {
    expect(signalGradeInputSchema.parse({ id: 3 }).id).toBe(3);
    expect(signalGradeInputSchema.safeParse({ id: -1 }).success).toBe(false);
  });
});

describe("signalGradeResultSchema", () => {
  it("accepts a valid verdict", () => {
    const parsed = signalGradeResultSchema.parse({
      id: 12,
      grade: 72,
      verdict: "runner",
      rationale: "Deep liquidity, strong mention momentum.",
    });
    expect(parsed.verdict).toBe("runner");
    expect(parsed.grade).toBe(72);
  });

  it("rejects an out-of-range grade", () => {
    expect(
      signalGradeResultSchema.safeParse({
        id: 12,
        grade: 140,
        verdict: "runner",
        rationale: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown verdict", () => {
    expect(
      signalGradeResultSchema.safeParse({
        id: 12,
        grade: 50,
        verdict: "moon",
        rationale: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects a rationale over the length cap", () => {
    expect(
      signalGradeResultSchema.safeParse({
        id: 12,
        grade: 50,
        verdict: "neutral",
        rationale: "x".repeat(201),
      }).success,
    ).toBe(false);
  });
});
