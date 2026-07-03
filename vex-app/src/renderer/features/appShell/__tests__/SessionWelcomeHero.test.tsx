/**
 * SessionWelcomeHero — phase-5 "Signal Sky" centered-hero contract.
 *
 * Pins the pieces other suites and the design system depend on:
 *   1. the H1 "What should I execute?" stays a REAL heading (shell-sidebar
 *      asserts it through the full AppShell; this is the close-range pin)
 *      and wears the landing barcode flicker (.vex-title-barcode);
 *   2. the stage carries the minimal centered grammar ONLY — the mono status
 *      line (now the TaglineRotator: rotating brand quips where the word VEX
 *      is the script monogram /logo_clean.png) + the H1 above the composer,
 *      and the bottom row copy (LOCAL-FIRST CAPITAL RUNTIME / YOU SIGN EVERY
 *      ACTION). The retired compositions stay dead: the phase-3 register
 *      stack, the phase-4 combined trust caption, AND the static "Register
 *      open" eyebrow the rotator replaced;
 *   3. the hero paints no canvas — the procedural WebGL sky is a sibling
 *      mounted BEHIND the panel — and its ONLY imagery is the inline script
 *      monogram (img[src="/logo_clean.png"], alt "Vex") inside the quips;
 *   4. the one-shot rise choreography stagger: status (.vex-rise) → H1 (d1)
 *      → bottom row (d4). The instrument (d2) and chips (d3) are staggered
 *      by SessionPanel / ComposerQuickActions, outside this component;
 *   5. the rotator contract: advances every ~4.2s replaying .vex-rise on a
 *      fresh keyed span, pauses while document.hidden, renders the first
 *      quip statically under prefers-reduced-motion, and keeps screen
 *      readers out of the rotation (aria-hidden line + stable sr-only copy).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionWelcomeHero } from "../SessionWelcomeHero.js";

const ROTATE_MS = 4200;

type MatchMediaListener = (event: MediaQueryListEvent) => void;

/** Minimal matchMedia stub — mirrors IntroScreen.test.tsx. */
function installMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const matches =
        reduced && query.includes("prefers-reduced-motion: reduce");
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: (_evt: string, _cb: MatchMediaListener) => undefined,
        removeEventListener: (_evt: string, _cb: MatchMediaListener) =>
          undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

function removeMatchMedia(): void {
  delete (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
}

/** Shadow document.hidden with an own getter (configurable → removable). */
function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

function restoreDocumentHidden(): void {
  delete (document as { hidden?: boolean }).hidden;
}

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
    // The rotator opens on quip 1 ("Time for VEXing?") with the monogram.
    expect(screen.getByText(/Time for/i)).not.toBeNull();
    expect(screen.getByAltText("Vex")).not.toBeNull();
    expect(screen.getByText("LOCAL-FIRST CAPITAL RUNTIME")).not.toBeNull();
    expect(screen.getByText("YOU SIGN EVERY ACTION")).not.toBeNull();
    // Retired compositions stay dead — the phase-3 register stack…
    expect(screen.queryByText("Peace of mind")).toBeNull();
    expect(
      screen.queryByText("Your rules hold, even when you look away."),
    ).toBeNull();
    expect(screen.queryByText("Policy before signing")).toBeNull();
    // …the phase-4 combined trust caption (split across the row)…
    expect(
      screen.queryByText("Local-first · You sign every action"),
    ).toBeNull();
    // …and the phase-5 static eyebrow the rotator replaced.
    expect(screen.queryByText("Register open")).toBeNull();
  });

  it("paints no canvas; its only imagery is the script monogram inside the quip", () => {
    const { container } = render(<SessionWelcomeHero />);
    expect(container.querySelector("canvas")).toBeNull();
    const images = Array.from(container.querySelectorAll("img"));
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.getAttribute("src")).toBe("/logo_clean.png");
      expect(img.getAttribute("alt")).toBe("Vex");
    }
  });

  it("staggers the one-shot rise choreography: status → H1 (d1) → bottom row (d4)", () => {
    const { container } = render(<SessionWelcomeHero />);
    const status = container.querySelector(".vex-eyebrow");
    expect(status).not.toBeNull();
    expect(status?.classList.contains("vex-rise")).toBe(true);
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

  describe("tagline rotator", () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
    });

    afterEach(() => {
      // Unmount under the same fake-timer regime that scheduled the
      // interval, so cleanup calls the mocked clearInterval (mirrors
      // IntroScreen.test.tsx); then drop the environment shims.
      cleanup();
      vi.useRealTimers();
      removeMatchMedia();
      restoreDocumentHidden();
    });

    it("advances to the next quip every ~4.2s on a fresh keyed .vex-rise span", () => {
      render(<SessionWelcomeHero />);
      const first = screen.getByText(/Time for/i);
      expect(first.classList.contains("vex-rise")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(ROTATE_MS);
      });
      // Quip 1 is gone; quip 2 ("VEXed your thoughts…") mounted fresh and
      // wears the one-shot rise again (keyed remount, no new keyframes).
      expect(screen.queryByText(/Time for/i)).toBeNull();
      const second = screen.getByText(/your thoughts/i);
      expect(second.classList.contains("vex-rise")).toBe(true);
      expect(screen.getByAltText("Vex")).not.toBeNull();
    });

    it("pauses rotation while document.hidden and resumes on visibility", () => {
      render(<SessionWelcomeHero />);
      setDocumentHidden(true);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => {
        vi.advanceTimersByTime(3 * ROTATE_MS);
      });
      // Hidden → no swaps happened.
      expect(screen.getByText(/Time for/i)).not.toBeNull();
      setDocumentHidden(false);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => {
        vi.advanceTimersByTime(ROTATE_MS);
      });
      expect(screen.getByText(/your thoughts/i)).not.toBeNull();
    });

    it("prefers-reduced-motion: no interval — the first quip renders statically", () => {
      installMatchMedia(true);
      render(<SessionWelcomeHero />);
      act(() => {
        vi.advanceTimersByTime(3 * ROTATE_MS);
      });
      expect(screen.getByText(/Time for/i)).not.toBeNull();
      expect(screen.queryByText(/your thoughts/i)).toBeNull();
      expect(screen.getByAltText("Vex")).not.toBeNull();
    });

    it("keeps screen readers out of the rotation: aria-hidden line + stable sr-only copy", () => {
      render(<SessionWelcomeHero />);
      expect(screen.getByText(/Time for/i).getAttribute("aria-hidden")).toBe(
        "true",
      );
      const stable = screen.getByText("Vex is ready.");
      expect(stable.classList.contains("sr-only")).toBe(true);
    });
  });
});
