import { describe, expect, it } from "vitest";
import {
  BOOK_SECTION_IDS,
  resolveBookSectionOrder,
} from "../book/bookSectionModel.js";

describe("resolveBookSectionOrder", () => {
  it("preserves a valid user order verbatim", () => {
    expect(resolveBookSectionOrder(["session", "moves", "runtime"])).toEqual([
      "session",
      "moves",
      "runtime",
    ]);
  });

  it("returns the canonical default for an empty order", () => {
    expect(resolveBookSectionOrder([])).toEqual([...BOOK_SECTION_IDS]);
  });

  it("drops unknown ids (stale/edited payload) but keeps the rest in order", () => {
    expect(
      resolveBookSectionOrder(["session", "position", "moves", "junk", "runtime"]),
    ).toEqual(["session", "moves", "runtime"]);
  });

  it("collapses duplicates to a single entry", () => {
    expect(resolveBookSectionOrder(["moves", "moves", "session"])).toEqual([
      "moves",
      "session",
      "runtime",
    ]);
  });

  it("appends any missing canonical id so a new section never vanishes", () => {
    // A payload written before "session" existed still renders it (at the end).
    expect(resolveBookSectionOrder(["runtime", "moves"])).toEqual([
      "runtime",
      "moves",
      "session",
    ]);
  });

  it("always yields exactly the canonical set, once each", () => {
    const resolved = resolveBookSectionOrder(["junk", "moves"]);
    expect([...resolved].sort()).toEqual([...BOOK_SECTION_IDS].sort());
  });
});
