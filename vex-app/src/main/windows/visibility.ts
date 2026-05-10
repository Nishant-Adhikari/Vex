/**
 * Window-bounds visibility normalization. Saved bounds from a previous
 * session may point at a display that no longer exists (laptop docked
 * to external monitor → undocked, multi-monitor → single, DPI change).
 * Restoring such bounds verbatim opens the window off-screen — taskbar
 * shows the entry but the user can't interact with it.
 *
 * Rules (codex turn 3):
 *   - x/y null  → pass through (Electron auto-positions on primary)
 *   - rectangle vs `display.workArea` (NOT `bounds` — workArea excludes
 *     taskbar/panel so the window doesn't tuck under the system shell)
 *   - require ≥ MIN_VISIBLE_PX × MIN_VISIBLE_PX visible on the
 *     best-matching display; otherwise center on primary
 *   - if partial overlap above threshold, shift the rect so it fits
 *     fully inside the best display's workArea (no off-screen edges)
 *   - clamp width/height to workArea so saved oversized bounds don't
 *     spill across displays
 */

export interface SavedWindowBounds {
  readonly width: number;
  readonly height: number;
  readonly x: number | null;
  readonly y: number | null;
}

export interface NormalizedWindowBounds {
  readonly width: number;
  readonly height: number;
  readonly x: number | null;
  readonly y: number | null;
}

export interface DisplayInfo {
  readonly workArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

const MIN_VISIBLE_PX = 80;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function intersectionArea(a: Rect, b: Rect): number {
  const overlapX = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const overlapY = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  return overlapX * overlapY;
}

function clampDimensionsToWorkArea(
  width: number,
  height: number,
  wa: DisplayInfo["workArea"]
): { width: number; height: number } {
  return {
    width: Math.min(width, wa.width),
    height: Math.min(height, wa.height),
  };
}

function centerOnDisplay(
  width: number,
  height: number,
  display: DisplayInfo
): NormalizedWindowBounds {
  const dims = clampDimensionsToWorkArea(width, height, display.workArea);
  const x = display.workArea.x + Math.floor((display.workArea.width - dims.width) / 2);
  const y = display.workArea.y + Math.floor((display.workArea.height - dims.height) / 2);
  return { width: dims.width, height: dims.height, x, y };
}

function shiftIntoWorkArea(
  rect: Rect,
  wa: DisplayInfo["workArea"]
): NormalizedWindowBounds {
  const dims = clampDimensionsToWorkArea(rect.width, rect.height, wa);
  // After clamping, shift origin so the rect fits fully inside [wa.x, wa.x+wa.width).
  // `Math.min(saved.x, max-allowed-x)` pushes rightward overflow back; outer
  // `Math.max(wa.x, ...)` covers the leftward case.
  const x = Math.max(wa.x, Math.min(rect.x, wa.x + wa.width - dims.width));
  const y = Math.max(wa.y, Math.min(rect.y, wa.y + wa.height - dims.height));
  return { width: dims.width, height: dims.height, x, y };
}

export function clampToVisibleArea(
  saved: SavedWindowBounds,
  displays: ReadonlyArray<DisplayInfo>,
  primary: DisplayInfo | null
): NormalizedWindowBounds {
  // Defensive: no displays at all (shouldn't happen on a real Electron
  // boot, but unit tests can hit this path).
  if (displays.length === 0 || primary === null) {
    return { width: saved.width, height: saved.height, x: null, y: null };
  }

  // x/y null → trust Electron's default placement on the primary display.
  // We still clamp width/height to that display's workArea.
  if (saved.x === null || saved.y === null) {
    const dims = clampDimensionsToWorkArea(
      saved.width,
      saved.height,
      primary.workArea
    );
    return { width: dims.width, height: dims.height, x: null, y: null };
  }

  const rect: Rect = {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
  };

  // Find the display with the largest intersection with the saved rect.
  let bestDisplay: DisplayInfo | null = null;
  let bestOverlap = 0;
  for (const d of displays) {
    const overlap = intersectionArea(rect, d.workArea);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestDisplay = d;
    }
  }

  // Insufficient overlap (less than the configured threshold) → recovery.
  // Center on primary so the user reliably sees the window again.
  if (bestDisplay === null || bestOverlap < MIN_VISIBLE_PX * MIN_VISIBLE_PX) {
    return centerOnDisplay(saved.width, saved.height, primary);
  }

  // Above threshold but possibly partial — shift rect inside best display's
  // workArea so no edge is cut off by the screen boundary.
  return shiftIntoWorkArea(rect, bestDisplay.workArea);
}
