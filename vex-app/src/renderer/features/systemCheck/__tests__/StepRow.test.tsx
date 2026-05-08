/**
 * Pin status → label/color mapping. Drift here would silently mislead
 * the user about whether a probe passed.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StepRow, type StepStatus } from "../StepRow.js";

describe("StepRow", () => {
  afterEach(cleanup);

  it.each<[StepStatus, string]>([
    ["loading", "checking…"],
    ["ok", "ok"],
    ["warn", "warn"],
    ["fail", "fail"],
  ])("renders status badge text for %s", (status, expectedText) => {
    const { getByText } = render(
      <StepRow label="Probe" status={status} detail={null} />
    );
    expect(getByText(expectedText)).toBeDefined();
  });

  it("renders detail line when provided", () => {
    const { getByText } = render(
      <StepRow label="Detecting OS" status="ok" detail="linux / x64" />
    );
    expect(getByText("linux / x64")).toBeDefined();
  });

  it("omits the detail span when detail is null", () => {
    // Detail span is the only `.text-xs` element in the row (label is the
    // default size; status badge uses `text-[10px]`). Querying for the
    // detail-specific class combo isolates the assertion.
    const { container } = render(
      <StepRow label="Network" status="loading" detail={null} />
    );
    expect(container.querySelectorAll(".text-xs.text-muted-foreground").length).toBe(0);
  });

  it("exposes status as data attribute (CSS hooks + e2e selectors)", () => {
    const { container } = render(
      <StepRow label="x" status="warn" detail={null} />
    );
    expect(container.querySelector('[data-step-status="warn"]')).not.toBeNull();
  });
});
