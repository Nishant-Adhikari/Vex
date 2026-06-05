/**
 * transactions-cursor codec — Stage 9 unit tests.
 *
 * Pins:
 *   - encode → decode round-trips the keyset tuple losslessly (incl. 6-digit µs).
 *   - garbage / wrong-shape / out-of-range cursors are REJECTED with CursorError
 *     (bounded — never a raw Zod/JSON throw, never echoes the input).
 *   - a microsecond-truncated timestamp is rejected (the codec demands the exact
 *     DB to_char shape so sub-ms ties paginate correctly).
 */

import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  CursorError,
  type DecodedCursor,
} from "@vex-agent/db/repos/transactions-cursor.js";

const VALID: DecodedCursor = {
  cursorTs: "2026-06-04T10:00:00.123456Z",
  sourceRank: 1,
  id: 42,
};

describe("transactions-cursor codec", () => {
  it("round-trips a valid cursor losslessly", () => {
    const encoded = encodeCursor(VALID);
    expect(typeof encoded).toBe("string");
    expect(decodeCursor(encoded)).toEqual(VALID);
  });

  it("preserves the full 6-digit microsecond precision", () => {
    const cursor: DecodedCursor = { cursorTs: "2026-06-04T10:00:00.000001Z", sourceRank: 0, id: 1 };
    expect(decodeCursor(encodeCursor(cursor)).cursorTs).toBe("2026-06-04T10:00:00.000001Z");
  });

  it("rejects non-base64 / non-JSON garbage with CursorError", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow(CursorError);
    expect(() => decodeCursor(Buffer.from("not json", "utf8").toString("base64"))).toThrow(CursorError);
  });

  it("rejects a wrong-shape object (missing fields)", () => {
    const bad = Buffer.from(JSON.stringify({ cursorTs: VALID.cursorTs }), "utf8").toString("base64");
    expect(() => decodeCursor(bad)).toThrow(CursorError);
  });

  it("rejects an out-of-range sourceRank", () => {
    const bad = Buffer.from(JSON.stringify({ ...VALID, sourceRank: 2 }), "utf8").toString("base64");
    expect(() => decodeCursor(bad)).toThrow(CursorError);
  });

  it("rejects a non-positive / non-integer id", () => {
    const zero = Buffer.from(JSON.stringify({ ...VALID, id: 0 }), "utf8").toString("base64");
    const frac = Buffer.from(JSON.stringify({ ...VALID, id: 1.5 }), "utf8").toString("base64");
    expect(() => decodeCursor(zero)).toThrow(CursorError);
    expect(() => decodeCursor(frac)).toThrow(CursorError);
  });

  it("rejects a millisecond-precision (3-digit) timestamp — demands the exact µs DB shape", () => {
    const ms = Buffer.from(JSON.stringify({ ...VALID, cursorTs: "2026-06-04T10:00:00.123Z" }), "utf8").toString("base64");
    expect(() => decodeCursor(ms)).toThrow(CursorError);
  });

  it("rejects a REGEX-SHAPED but calendar-impossible timestamp (Stage 9 semantic guard)", () => {
    // These pass the shape regex but are not real UTC datetimes; they must be
    // rejected in the CODEC, before the value can reach the ::timestamptz bind.
    const forgeries = [
      "2026-99-99T99:99:99.123456Z", // month/day/hour/min/sec all out of range
      "2026-13-01T00:00:00.000000Z", // month 13
      "2026-00-01T00:00:00.000000Z", // month 0
      "2026-02-30T00:00:00.000000Z", // Feb 30 — never exists
      "2026-01-32T00:00:00.000000Z", // day 32
      "2026-01-01T24:00:00.000000Z", // hour 24
      "2026-01-01T00:60:00.000000Z", // minute 60
      "2025-02-29T00:00:00.000000Z", // 2025 is not a leap year
    ];
    for (const cursorTs of forgeries) {
      const forged = Buffer.from(JSON.stringify({ ...VALID, cursorTs }), "utf8").toString("base64");
      expect(() => decodeCursor(forged), `forgery ${cursorTs} must be rejected`).toThrow(CursorError);
    }
  });

  it("accepts a genuine leap-day timestamp (2024-02-29) — the guard is not over-strict", () => {
    const leap: DecodedCursor = { cursorTs: "2024-02-29T23:59:59.999999Z", sourceRank: 1, id: 7 };
    expect(decodeCursor(encodeCursor(leap))).toEqual(leap);
  });

  it("CursorError message is bounded and does not echo the raw input", () => {
    try {
      decodeCursor("totally-bogus-secret-looking-string");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CursorError);
      expect((err as CursorError).message).toBe("invalid cursor");
      expect((err as CursorError).message).not.toContain("bogus");
    }
  });

  it("refuses to mint a cursor from an internally-malformed tuple", () => {
    // encodeCursor validates on the way out — an out-of-range tuple cannot become
    // a cursor that would later fail to decode.
    expect(() => encodeCursor({ cursorTs: "nope", sourceRank: 0, id: 1 })).toThrow();
  });
});
