/**
 * Tests for window-bounds visibility normalization. Mirrors the
 * scenarios that broke live smoke testing M6 on WSLg: saved x/y from
 * a previous multi-monitor session restored on a single-display
 * laptop (codex turn 3).
 */

import { describe, expect, it } from "vitest";
import {
  clampToVisibleArea,
  type DisplayInfo,
  type SavedWindowBounds,
} from "../visibility.js";

const PRIMARY: DisplayInfo = {
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const SECONDARY: DisplayInfo = {
  workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
};

const SMALL_LAPTOP: DisplayInfo = {
  workArea: { x: 0, y: 0, width: 1366, height: 768 },
};

describe("clampToVisibleArea", () => {
  it("passes saved bounds through when fully inside primary", () => {
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: 100,
      y: 100,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result).toEqual({ width: 1280, height: 800, x: 100, y: 100 });
  });

  it("passes through with x=null/y=null (Electron auto-positions)", () => {
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: null,
      y: null,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it("centers on primary when saved x is far off-screen on single display", () => {
    // The exact bug user hit: x=2123 from a previous dual-monitor session.
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: 2123,
      y: 197,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.x).toBe(Math.floor((1920 - 1280) / 2));
    expect(result.y).toBe(Math.floor((1080 - 800) / 2));
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it("preserves bounds when saved x falls inside a secondary display", () => {
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: 2123,
      y: 197,
    };
    const result = clampToVisibleArea(
      saved,
      [PRIMARY, SECONDARY],
      PRIMARY
    );
    // 2123 is inside SECONDARY (1920..3840) — bounds should pass through.
    expect(result).toEqual({ width: 1280, height: 800, x: 2123, y: 197 });
  });

  it("clamps width when saved is wider than display workArea", () => {
    const saved: SavedWindowBounds = {
      width: 3000,
      height: 800,
      x: 100,
      y: 100,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.width).toBe(1920);
  });

  it("clamps height when saved is taller than display workArea", () => {
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 2000,
      x: 100,
      y: 100,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.height).toBe(1080);
  });

  it("shifts x left when saved bounds extend past right edge", () => {
    // x=1500 + width=800 = 2300, primary right edge at 1920 → must shift.
    const saved: SavedWindowBounds = {
      width: 800,
      height: 600,
      x: 1500,
      y: 100,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.x).toBe(1920 - 800); // 1120
    expect(result.y).toBe(100);
    expect(result.width).toBe(800);
  });

  it("shifts y up when saved bounds extend past bottom edge", () => {
    const saved: SavedWindowBounds = {
      width: 800,
      height: 600,
      x: 100,
      y: 700,
    };
    // y=700 + height=600 = 1300, primary bottom at 1080 → must shift.
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.y).toBe(1080 - 600); // 480
  });

  it("centers on primary when visible area is below 80x80 threshold", () => {
    // x=1900,y=1050 leaves only 20x30 visible against PRIMARY (1920x1080).
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: 1900,
      y: 1050,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.x).toBe(Math.floor((1920 - 1280) / 2));
    expect(result.y).toBe(Math.floor((1080 - 800) / 2));
  });

  it("centers on primary when saved bounds are wholly negative-x", () => {
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: -3000,
      y: 100,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.x).toBe(Math.floor((1920 - 1280) / 2));
  });

  it("returns null x/y when no displays present (defensive)", () => {
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: 100,
      y: 100,
    };
    const result = clampToVisibleArea(saved, [], null);
    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it("handles small laptop display with oversized saved bounds", () => {
    // 1280x800 saved bounds, 1366x768 display — height clamps to 768.
    const saved: SavedWindowBounds = {
      width: 1280,
      height: 800,
      x: 0,
      y: 0,
    };
    const result = clampToVisibleArea(
      saved,
      [SMALL_LAPTOP],
      SMALL_LAPTOP
    );
    expect(result.width).toBe(1280);
    expect(result.height).toBe(768);
  });

  it("clamps width via centering when bounds are wider than primary AND off-screen", () => {
    const saved: SavedWindowBounds = {
      width: 3000,
      height: 800,
      x: 5000,
      y: 5000,
    };
    const result = clampToVisibleArea(saved, [PRIMARY], PRIMARY);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(800);
    // Centering: x = 0 + floor((1920 - 1920)/2) = 0
    expect(result.x).toBe(0);
  });

  it("picks the display with the largest overlap when bounds straddle two displays", () => {
    // x=1700 width=600 → 220px on PRIMARY (1700..1920), 380px on SECONDARY (1920..2300).
    // Best overlap = SECONDARY → shift to fit inside SECONDARY.
    const saved: SavedWindowBounds = {
      width: 600,
      height: 400,
      x: 1700,
      y: 100,
    };
    const result = clampToVisibleArea(
      saved,
      [PRIMARY, SECONDARY],
      PRIMARY
    );
    // SECONDARY workArea is x=1920..3840 — saved x=1700 must shift to >=1920.
    expect(result.x).toBeGreaterThanOrEqual(1920);
    expect(result.x).toBeLessThanOrEqual(1920 + 1920 - 600);
  });
});
