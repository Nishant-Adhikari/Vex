import { describe, expect, it } from "vitest";
import { formatSessionTime } from "../sessionListModel.js";

describe("formatSessionTime", () => {
  it("formats older dates with an English (en-US) month, not the OS locale", () => {
    // Mid-month + midday UTC: the local date stays within June across every
    // timezone (UTC-12..UTC+14), so the English month abbreviation is
    // deterministic. A non-English OS locale (e.g. Polish "cze") would fail
    // this assertion, which is exactly the regression we guard against.
    const result = formatSessionTime("2020-06-15T12:00:00Z");
    expect(result).toMatch(/^Jun \d{1,2}$/);
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatSessionTime("not-a-date")).toBe("");
  });
});
