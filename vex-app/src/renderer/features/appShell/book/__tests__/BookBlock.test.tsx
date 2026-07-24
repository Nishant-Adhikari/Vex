/**
 * BookBlock — the BOOK section chrome. Verifies the additive collapsible
 * (accordion) mode: static by default (body always present), and a disclosure
 * toggle when `collapsible` that hides/shows the body with correct aria state.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { BookBlock } from "../BookBlock.js";

describe("BookBlock", () => {
  it("renders a static section (no toggle button) by default", () => {
    render(
      createElement(
        BookBlock,
        { title: "Moves" },
        createElement("p", null, "body-content"),
      ),
    );
    expect(screen.getByText("body-content")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("collapsible: body visible by default, header is an expanded toggle", () => {
    render(
      createElement(
        BookBlock,
        { title: "Session", collapsible: true },
        createElement("p", null, "session-body"),
      ),
    );
    const toggle = screen.getByRole("button", { name: /Session/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("session-body")).toBeTruthy();
  });

  it("collapsible: clicking the header collapses and re-expands the body", () => {
    render(
      createElement(
        BookBlock,
        { title: "Session", collapsible: true },
        createElement("p", null, "session-body"),
      ),
    );
    const toggle = screen.getByRole("button", { name: /Session/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("session-body")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("session-body")).toBeTruthy();
  });

  it("collapsible: respects defaultOpen=false (starts collapsed)", () => {
    render(
      createElement(
        BookBlock,
        { title: "Runtime & Cost", collapsible: true, defaultOpen: false },
        createElement("p", null, "runtime-body"),
      ),
    );
    const toggle = screen.getByRole("button", { name: /Runtime & Cost/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("runtime-body")).toBeNull();
  });
});
