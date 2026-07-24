/**
 * signals-db tests — the read query builder + row→DTO mapping.
 *
 * `pg.Client` + `buildPoolConfig` are mocked, so `listTodaySignals` exercises
 * the real SQL/param builder and the real `mapSignalRow` against a fake result
 * set. The pure `extractRawFields` / `mapSignalRow` are also asserted directly:
 * the three `raw.*` fields are lifted here and the arbitrary provider jsonb
 * never crosses into the DTO. Fail-soft: a DB error → an `internal.unexpected`
 * error Result (never a throw).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const queryMock = vi.fn();
const endMock = vi.fn();

vi.mock("pg", () => ({
  Client: class {
    connect = connectMock;
    query = queryMock;
    end = endMock;
  },
}));

vi.mock("../db-config.js", () => ({
  buildPoolConfig: vi.fn(async () => ({
    host: "localhost",
    port: 5432,
    database: "vex",
    user: "vex",
    password: "pw",
  })),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { listTodaySignals, mapSignalRow, extractRawFields } = await import(
  "../signals-db.js"
);

const DB_ROW = {
  id: "12",
  source: "trendradar",
  chain: "solana",
  contract: "So1111",
  symbol: "WIF",
  action: "watch",
  score: "87",
  today_mentions: "140",
  yesterday_mentions: "40",
  velocity_pct: "250",
  liquidity_usd: 1_200_000,
  volume_24h_usd: 8_000_000,
  price_usd: 2.31,
  narratives: ["dogs"],
  risk_flags: ["low_liquidity"],
  raw: {
    price_change_24h_pct: 18.4,
    market_cap: 2_000_000_000,
    dexscreener_url: "https://dexscreener.com/solana/abc",
    secret_internal: "must-not-leak",
  },
  feed_generated_at: new Date("2026-07-23T10:00:00.000Z"),
  ingested_at: new Date("2026-07-23T10:05:00.000Z"),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("extractRawFields", () => {
  it("lifts the three known fields and drops everything else", () => {
    expect(extractRawFields(DB_ROW.raw)).toEqual({
      priceChange24hPct: 18.4,
      marketCapUsd: 2_000_000_000,
      dexscreenerUrl: "https://dexscreener.com/solana/abc",
    });
  });

  it("falls back to fdv for market cap", () => {
    expect(extractRawFields({ fdv: 500 }).marketCapUsd).toBe(500);
  });

  it("returns all-nulls for non-object raw (defensive)", () => {
    expect(extractRawFields(null)).toEqual({
      priceChange24hPct: null,
      marketCapUsd: null,
      dexscreenerUrl: null,
    });
    expect(extractRawFields([1, 2, 3]).dexscreenerUrl).toBeNull();
    expect(extractRawFields("nope").marketCapUsd).toBeNull();
  });
});

describe("mapSignalRow", () => {
  it("coerces numeric-string columns and ISO-formats timestamps", () => {
    const dto = mapSignalRow(DB_ROW);
    expect(dto.id).toBe(12);
    expect(dto.score).toBe(87);
    expect(dto.todayMentions).toBe(140);
    expect(dto.liquidityUsd).toBe(1_200_000);
    expect(dto.priceChange24hPct).toBe(18.4);
    expect(dto.marketCapUsd).toBe(2_000_000_000);
    expect(dto.dexscreenerUrl).toBe("https://dexscreener.com/solana/abc");
    expect(dto.ingestedAt).toBe("2026-07-23T10:05:00.000Z");
    expect(dto.feedGeneratedAt).toBe("2026-07-23T10:00:00.000Z");
  });

  it("never surfaces raw internal keys on the DTO", () => {
    const dto = mapSignalRow(DB_ROW) as Record<string, unknown>;
    expect(dto["raw"]).toBeUndefined();
    expect(dto["secret_internal"]).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("must-not-leak");
  });
});

describe("listTodaySignals", () => {
  it("builds a windowed, score-ordered, bounded query and maps rows", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValue({ rows: [DB_ROW] });
    endMock.mockResolvedValue(undefined);

    const res = await listTodaySignals({ withinHours: 24, limit: 50 }, "corr-1");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.symbol).toBe("WIF");

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/FROM signals/);
    expect(sql).toMatch(/ingested_at > NOW\(\) - make_interval/);
    expect(sql).toMatch(/ORDER BY score DESC NULLS LAST/);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(params).toEqual([24, 50]);
  });

  it("fails soft to an error Result when the query throws", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockRejectedValue(new Error("boom"));
    endMock.mockResolvedValue(undefined);

    const res = await listTodaySignals({ withinHours: 24, limit: 50 }, "corr-1");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected err");
    expect(res.error.code).toBe("internal.unexpected");
    expect(res.error.domain).toBe("signals");
  });

  it("fails soft when the DB config is absent", async () => {
    const { buildPoolConfig } = await import("../db-config.js");
    vi.mocked(buildPoolConfig).mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof buildPoolConfig>>,
    );
    const res = await listTodaySignals({ withinHours: 24, limit: 50 }, "corr-1");
    expect(res.ok).toBe(false);
  });
});
