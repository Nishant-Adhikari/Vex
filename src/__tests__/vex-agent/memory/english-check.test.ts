/**
 * English-by-contract boundary check unit tests (§10.4). Calibrated against
 * the exported BENCHMARK_PAIRS so the heuristic is pinned to real fixture
 * text: every English row passes; pl/fr/zh/vi rows (and diacritic-stripped
 * Polish) fail. Plus threshold boundary pins for the named constants and the
 * over-rejection protections (terse titles, noun-heavy technical English,
 * code-block-heavy content).
 */

import { describe, it, expect } from "vitest";

import {
  checkLongMemorySuggestEnglish,
  ENGLISH_STOPWORD_MIN_FRACTION,
  ENTITY_NON_ASCII_LETTER_MAX,
  MIN_WORDS_FOR_STOPWORD_CHECK,
  NON_ASCII_LETTER_MAX_FRACTION,
  type LongMemorySuggestEnglishInput,
} from "@vex-agent/memory/english-check.js";
import { BENCHMARK_PAIRS } from "@vex-agent/scripts/cross-lingual-benchmark-dataset.js";

function input(overrides: Partial<LongMemorySuggestEnglishInput> = {}): LongMemorySuggestEnglishInput {
  return {
    title: "Back off on repeated 429s",
    summary:
      "When a protocol rate-limits bursts, wait and retry with backoff rather than hammering it.",
    contentMd: "",
    entities: [],
    tags: [],
    ...overrides,
  };
}

/**
 * Strip diacritics the way a "lazy transliteration" would: NFD combining
 * marks plus ł/Ł (which does not decompose under NFD).
 */
function stripDiacritics(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L");
}

describe("english-check — benchmark calibration", () => {
  const enRows = BENCHMARK_PAIRS.filter((p) => p.lang === "en");
  const nonEnRows = BENCHMARK_PAIRS.filter((p) => p.lang !== "en");

  it("dataset sanity: both sides of the calibration are populated", () => {
    expect(enRows.length).toBeGreaterThan(0);
    expect(nonEnRows.length).toBeGreaterThan(0);
  });

  it("accepts every English benchmark row (title+summary)", () => {
    for (const row of enRows) {
      const res = checkLongMemorySuggestEnglish(
        input({ title: row.titleEn, summary: row.summaryEn }),
      );
      expect(res.rejected, `${row.id} must pass`).toBe(false);
      expect(res.reason).toBeNull();
      expect(res.field).toBeNull();
    }
  });

  it("rejects every native pl/fr/zh/vi benchmark row (title+summary)", () => {
    for (const row of nonEnRows) {
      const res = checkLongMemorySuggestEnglish(
        input({ title: row.titleNative, summary: row.summaryNative }),
      );
      expect(res.rejected, `${row.id} must fail`).toBe(true);
      expect(res.field, `${row.id} fails on prose`).toBe("prose");
    }
  });

  it("rejects diacritic-stripped Polish prose via the stopword metric (metric B)", () => {
    const pl = BENCHMARK_PAIRS.find((p) => p.id === "pl-slippage");
    expect(pl).toBeDefined();
    if (!pl) return;
    const res = checkLongMemorySuggestEnglish(
      input({
        title: stripDiacritics(pl.titleNative),
        summary: stripDiacritics(pl.summaryNative),
      }),
    );
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe("low_english_stopwords");
    expect(res.field).toBe("prose");
  });
});

describe("english-check — over-rejection protections", () => {
  it("accepts a short ticker-heavy title below the stopword-check word floor", () => {
    const res = checkLongMemorySuggestEnglish(
      input({ title: "Kyber quote timeout pattern", summary: "" }),
    );
    expect(res.rejected).toBe(false);
  });

  it("accepts terse, noun-heavy technical English at/above the word floor", () => {
    const res = checkLongMemorySuggestEnglish(
      input({
        title: "Kyber aggregator quote timeout",
        summary: "Retry backoff pattern observed in Base mainnet congestion windows.",
      }),
    );
    expect(res.rejected).toBe(false);
  });

  it("accepts code-block-heavy English contentMd (code spans and URLs exempt)", () => {
    const res = checkLongMemorySuggestEnglish(
      input({
        contentMd: [
          "The retry loop that worked after the 429 storm:",
          "```ts",
          "const wynik = await pobierzSaldo(portfel); // non-English identifiers are fine in code",
          "zażółć_gęślą_jaźń(wynik);",
          "```",
          "Docs at https://docs.kyberswap.com/zażółć and the inline call `pobierzSaldo()` were not the issue.",
        ].join("\n"),
      }),
    );
    expect(res.rejected).toBe(false);
  });

  it("accepts prose with an occasional diacritic loanword (naïve/café tolerance)", () => {
    const res = checkLongMemorySuggestEnglish(
      input({
        summary:
          "A naïve retry strategy against the café-tier RPC endpoint keeps failing when the provider rate-limits during congestion.",
      }),
    );
    expect(res.rejected).toBe(false);
  });
});

describe("english-check — entities and tags (per-string metric A only)", () => {
  it("accepts ticker / protocol-id / ASCII-label entities and tags", () => {
    const res = checkLongMemorySuggestEnglish(
      input({ entities: ["SOL", "kyberswap"], tags: ["risk", "memecoin"] }),
    );
    expect(res.rejected).toBe(false);
  });

  it("rejects a diacritic descriptor entity", () => {
    const res = checkLongMemorySuggestEnglish(
      input({ entities: ["preferencja użytkownika"] }),
    );
    expect(res.rejected).toBe(true);
    expect(res.reason).toBe("non_ascii_letters");
    expect(res.field).toBe("entities_tags");
  });

  it("rejects a diacritic descriptor tag", () => {
    const res = checkLongMemorySuggestEnglish(input({ tags: ["zarządzanie ryzykiem"] }));
    expect(res.rejected).toBe(true);
    expect(res.field).toBe("entities_tags");
  });

  it("documented limitation: ASCII-only non-English entity descriptors pass metric A", () => {
    const res = checkLongMemorySuggestEnglish(
      input({ entities: ["preferencja uzytkownika"] }),
    );
    expect(res.rejected).toBe(false);
  });
});

describe("english-check — threshold boundaries (named constants pinned)", () => {
  it("pins the named constants", () => {
    expect(NON_ASCII_LETTER_MAX_FRACTION).toBe(0.05);
    expect(MIN_WORDS_FOR_STOPWORD_CHECK).toBe(8);
    expect(ENGLISH_STOPWORD_MIN_FRACTION).toBe(0.04);
    expect(ENTITY_NON_ASCII_LETTER_MAX).toBe(0);
  });

  it("metric A boundary: exactly 5% non-ASCII letters passes, just above fails", () => {
    // 19 ASCII letters + 1 non-ASCII = 1/20 = 0.05 → NOT > threshold → pass.
    const atThreshold = checkLongMemorySuggestEnglish(
      input({ title: "abcdefghijklmnopqrs" + "ą", summary: "" }),
    );
    expect(atThreshold.rejected).toBe(false);
    // 18 ASCII letters + 1 non-ASCII = 1/19 ≈ 0.0526 > threshold → reject.
    const aboveThreshold = checkLongMemorySuggestEnglish(
      input({ title: "abcdefghijklmnopqr" + "ą", summary: "" }),
    );
    expect(aboveThreshold.rejected).toBe(true);
    expect(aboveThreshold.reason).toBe("non_ascii_letters");
    expect(aboveThreshold.field).toBe("prose");
  });

  it("metric B word floor: 8 stopword-free words reject, 7 pass", () => {
    const words = (n: number): string =>
      Array.from({ length: n }, (_, i) => `asset${i}`).join(" ");
    const atFloor = checkLongMemorySuggestEnglish(input({ title: words(8), summary: "" }));
    expect(atFloor.rejected).toBe(true);
    expect(atFloor.reason).toBe("low_english_stopwords");
    const belowFloor = checkLongMemorySuggestEnglish(input({ title: words(7), summary: "" }));
    expect(belowFloor.rejected).toBe(false);
  });

  it("metric B fraction boundary: 1 stopword in 25 tokens passes, 1 in 26 rejects", () => {
    const fillers = (n: number): string =>
      Array.from({ length: n }, (_, i) => `asset${i}`).join(" ");
    // 24 fillers + "the" = 25 tokens → 1/25 = 0.04 → NOT < threshold → pass.
    const atThreshold = checkLongMemorySuggestEnglish(
      input({ title: `${fillers(24)} the`, summary: "" }),
    );
    expect(atThreshold.rejected).toBe(false);
    // 25 fillers + "the" = 26 tokens → 1/26 ≈ 0.0385 < threshold → reject.
    const belowThreshold = checkLongMemorySuggestEnglish(
      input({ title: `${fillers(25)} the`, summary: "" }),
    );
    expect(belowThreshold.rejected).toBe(true);
    expect(belowThreshold.reason).toBe("low_english_stopwords");
  });

  it("empty / letterless input passes (nothing to judge)", () => {
    const res = checkLongMemorySuggestEnglish(
      input({ title: "429 5xx 0.5%", summary: "", contentMd: "", entities: [], tags: [] }),
    );
    expect(res.rejected).toBe(false);
  });
});
