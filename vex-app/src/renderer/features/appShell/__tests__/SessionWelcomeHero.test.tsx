/**
 * SessionWelcomeHero — phase-5 "Signal Sky" centered-hero contract.
 *
 * Pins the pieces other suites and the design system depend on:
 *   1. the H1 "What should I execute?" stays a REAL heading (shell-sidebar
 *      asserts it through the full AppShell; this is the close-range pin)
 *      and wears the landing barcode flicker (.vex-title-barcode);
 *   2. the stage carries the minimal centered grammar ONLY — the mono status
 *      line ("Register open") + the H1 above the composer, and the bottom
 *      row copy (LOCAL-FIRST CAPITAL RUNTIME / YOU SIGN EVERY ACTION). The
 *      retired compositions stay dead: the phase-3 register stack AND the
 *      phase-4 combined trust caption;
 *   3. the hero paints no canvas and no imagery of its own — the procedural
 *      WebGL sky is a sibling mounted BEHIND the panel, so the hero must
 *      stay transparent (only the bottom vignette gradient is its own);
 *   4. the one-shot rise choreography stagger: status (.vex-rise) → H1 (d1)
 *      → bottom row (d4). The instrument (d2) and chips (d3) are staggered
 *      by SessionPanel / ComposerQuickActions, outside this component.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionWelcomeHero } from "../SessionWelcomeHero.js";

describe("SessionWelcomeHero", () => {
  it("keeps the pinned H1 as a real heading wearing the landing barcode flicker", () => {
    render(<SessionWelcomeHero />);
    const h1 = screen.getByRole("heading", {
      level: 1,
      name: /What should I execute\?/i,
    });
    expect(h1.classList.contains("vex-title-barcode")).toBe(true);
  });

  it("renders ONLY the centered status line + H1 above the composer, plus the bottom row copy", () => {
    render(<SessionWelcomeHero />);
    expect(screen.getByText("Register open")).not.toBeNull();
    expect(screen.getByText("LOCAL-FIRST CAPITAL RUNTIME")).not.toBeNull();
    expect(screen.getByText("YOU SIGN EVERY ACTION")).not.toBeNull();
    // Retired compositions stay dead — the phase-3 register stack…
    expect(screen.queryByText("Peace of mind")).toBeNull();
    expect(
      screen.queryByText("Your rules hold, even when you look away."),
    ).toBeNull();
    expect(screen.queryByText("Policy before signing")).toBeNull();
    // …and the phase-4 combined trust caption (now split across the row).
    expect(
      screen.queryByText("Local-first · You sign every action"),
    ).toBeNull();
  });

  it("paints no canvas and no imagery of its own — the sky lives behind the stage", () => {
    const { container } = render(<SessionWelcomeHero />);
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("staggers the one-shot rise choreography: status → H1 (d1) → bottom row (d4)", () => {
    render(<SessionWelcomeHero />);
    const status = screen.getByText("Register open");
    expect(status.classList.contains("vex-rise")).toBe(true);
    const h1 = screen.getByRole("heading", {
      level: 1,
      name: /What should I execute\?/i,
    });
    expect(h1.classList.contains("vex-rise")).toBe(true);
    expect(h1.classList.contains("vex-rise-d1")).toBe(true);
    // The bottom row rises LAST (d4) as one unit.
    const bottomRow = screen
      .getByText("YOU SIGN EVERY ACTION")
      .closest(".vex-rise");
    expect(bottomRow).not.toBeNull();
    expect(bottomRow?.classList.contains("vex-rise-d4")).toBe(true);
  });
});
