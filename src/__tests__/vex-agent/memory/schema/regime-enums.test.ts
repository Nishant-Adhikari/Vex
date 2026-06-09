/**
 * Lockstep guard: SQL CHECK constraints ↔ TS `as const` arrays ↔ Zod options
 * for the regime bounded vocabularies (S6b).
 *
 * Four closed enums on `regime_snapshots` (`trend_label`, `vol_label`,
 * `confidence`, `source`) use plain IN-list CHECKs and are parsed with the
 * shared `parseCheckInList`. The lesson-tag vocabulary on
 * `knowledge_entries.regime_tags` is enforced by an ARRAY-CONTAINMENT check
 * (`regime_tags <@ ARRAY[...]::TEXT[]` — the column is TEXT[], an IN-list
 * cannot express it), so it gets a DEDICATED parser here.
 *
 * Also pins the pure helpers: `tagAxis` (every tag maps to a concrete axis
 * value — never 'unknown') and the confidence rank/min used by the F4 cap and
 * the dwell corroboration.
 */

import { describe, it, expect } from "vitest";

import {
  REGIME_TREND_LABELS,
  REGIME_VOL_LABELS,
  REGIME_CONFIDENCES,
  REGIME_SOURCES,
  REGIME_TAGS,
  regimeTrendLabelSchema,
  regimeVolLabelSchema,
  regimeConfidenceSchema,
  regimeSourceSchema,
  regimeTagSchema,
  regimeConfidenceRank,
  minRegimeConfidence,
  tagAxis,
} from "@vex-agent/memory/schema/regime-enums.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

/**
 * Extract the quoted value list from an ARRAY-CONTAINMENT CHECK of the form
 * `CONSTRAINT <name> CHECK (<column> <@ ARRAY['a','b',...]::TEXT[])`. The
 * IN-list parser cannot match this shape; like it, this throws when the
 * constraint is absent so a rename/removal fails loudly.
 */
function parseCheckArrayContainment(sql: string, constraintName: string, column: string): string[] {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(\\s*${column}\\s*<@\\s*ARRAY\\[([^\\]]*)\\]::TEXT\\[\\]`,
    "i",
  );
  const match = re.exec(sql);
  if (!match) {
    throw new Error(
      `lockstep: containment CHECK '${constraintName}' on column '${column}' not found in 001_initial.sql`,
    );
  }
  return match[1]!
    .split(",")
    .map((token) => token.trim().replace(/^'(.*)'$/, "$1"))
    .filter((token) => token.length > 0);
}

describe("regime enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("trend_label CHECK equals REGIME_TREND_LABELS and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "rs_trend_valid", "trend_label");
    expect(sorted(sqlValues)).toEqual(sorted(REGIME_TREND_LABELS));
    expect(sorted(sqlValues)).toEqual(sorted(regimeTrendLabelSchema.options));
    expect(regimeTrendLabelSchema.options).toEqual([...REGIME_TREND_LABELS]);
  });

  it("vol_label CHECK equals REGIME_VOL_LABELS and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "rs_vol_valid", "vol_label");
    expect(sorted(sqlValues)).toEqual(sorted(REGIME_VOL_LABELS));
    expect(sorted(sqlValues)).toEqual(sorted(regimeVolLabelSchema.options));
    expect(regimeVolLabelSchema.options).toEqual([...REGIME_VOL_LABELS]);
  });

  it("confidence CHECK equals REGIME_CONFIDENCES and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "rs_confidence_valid", "confidence");
    expect(sorted(sqlValues)).toEqual(sorted(REGIME_CONFIDENCES));
    expect(sorted(sqlValues)).toEqual(sorted(regimeConfidenceSchema.options));
    expect(regimeConfidenceSchema.options).toEqual([...REGIME_CONFIDENCES]);
  });

  it("source CHECK equals REGIME_SOURCES and schema.options (and excludes 'heuristic' — fail-closed doctrine)", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "rs_source_valid", "source");
    expect(sorted(sqlValues)).toEqual(sorted(REGIME_SOURCES));
    expect(sorted(sqlValues)).toEqual(sorted(regimeSourceSchema.options));
    expect(regimeSourceSchema.options).toEqual([...REGIME_SOURCES]);
    expect(sqlValues).not.toContain("heuristic");
  });

  it("ke_regime_tags_valid containment CHECK equals REGIME_TAGS and regimeTagSchema.options", () => {
    const sqlValues = parseCheckArrayContainment(MIGRATION_SQL, "ke_regime_tags_valid", "regime_tags");
    expect(sorted(sqlValues)).toEqual(sorted(REGIME_TAGS));
    expect(sorted(sqlValues)).toEqual(sorted(regimeTagSchema.options));
    expect(regimeTagSchema.options).toEqual([...REGIME_TAGS]);
  });

  it("guards against a missing/renamed constraint (both parsers are fail-loud)", () => {
    expect(() => parseCheckInList(MIGRATION_SQL, "rs_does_not_exist", "trend_label")).toThrow(
      /not found in 001_initial\.sql/,
    );
    expect(() =>
      parseCheckArrayContainment(MIGRATION_SQL, "ke_does_not_exist", "regime_tags"),
    ).toThrow(/not found in 001_initial\.sql/);
  });

  it("the containment parser does NOT silently match an IN-list CHECK (shape-specific)", () => {
    expect(() => parseCheckArrayContainment(MIGRATION_SQL, "rs_trend_valid", "trend_label")).toThrow(
      /not found/,
    );
  });
});

describe("tagAxis — pure tag → axis mapping", () => {
  it("maps trend tags to the trend axis and vol tags (axis-qualified) to the vol axis", () => {
    expect(tagAxis("bull")).toEqual({ axis: "trend", value: "bull" });
    expect(tagAxis("bear")).toEqual({ axis: "trend", value: "bear" });
    expect(tagAxis("range")).toEqual({ axis: "trend", value: "range" });
    expect(tagAxis("high_vol")).toEqual({ axis: "vol", value: "high" });
    expect(tagAxis("low_vol")).toEqual({ axis: "vol", value: "low" });
  });

  it("every tag in the vocabulary maps to a CONCRETE axis value (never 'unknown')", () => {
    for (const tag of REGIME_TAGS) {
      const mapped = tagAxis(tag);
      expect(mapped.value).not.toBe("unknown");
      if (mapped.axis === "trend") {
        expect(REGIME_TREND_LABELS).toContain(mapped.value);
      } else {
        expect(REGIME_VOL_LABELS).toContain(mapped.value);
      }
    }
  });
});

describe("confidence rank + min (F4)", () => {
  it("orders low < medium < high", () => {
    expect(regimeConfidenceRank.low).toBeLessThan(regimeConfidenceRank.medium);
    expect(regimeConfidenceRank.medium).toBeLessThan(regimeConfidenceRank.high);
  });

  it("minRegimeConfidence picks the lower bucket (symmetric)", () => {
    expect(minRegimeConfidence("high", "low")).toBe("low");
    expect(minRegimeConfidence("low", "high")).toBe("low");
    expect(minRegimeConfidence("high", "medium")).toBe("medium");
    expect(minRegimeConfidence("medium", "medium")).toBe("medium");
  });
});
