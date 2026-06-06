/**
 * Render smoke test for the `dotmatrix-core` visual primitive.
 *
 * The source file (`dotmatrix-core.tsx`) carries no behavioural logic worth a
 * unit test, but it WAS split from a single 960-line module into nested
 * `dotmatrix-core/` leaf modules behind a façade (batch A-057). This test pins
 * the gross structural contract the split must preserve: the grid renders
 * exactly MATRIX_SIZE*MATRIX_SIZE dot cells, every cell carries the `dmx-dot`
 * class, and the count of ACTIVE cells (those without `dmx-inactive`) equals
 * the pattern's index count. It also pins that a `createPathWaveComponent`
 * output drives active dots through the path-wave resolver (the `--dmx-path`
 * CSS variable). jsdom has no layout engine, so this is structural only — the
 * real animation/visual fidelity stays a manual/screenshot check.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  createPathWaveComponent,
  DotMatrixBase,
  getPatternIndexes,
  MATRIX_SIZE,
  snakePathNormFromIndex,
  type MatrixPattern,
} from "../dotmatrix-core.js";

const TOTAL_CELLS = MATRIX_SIZE * MATRIX_SIZE;

describe("DotMatrixBase (dotmatrix-core split smoke)", () => {
  it.each<MatrixPattern>(["diamond", "full"])(
    "renders %s pattern with the full grid and correct active-cell count",
    (pattern) => {
      const { container } = render(
        <DotMatrixBase phase="idle" pattern={pattern} />,
      );

      const grid = container.querySelector(".dmx-grid");
      expect(grid).not.toBeNull();

      const dots = grid!.querySelectorAll(".dmx-dot");
      // Every cell renders, and the grid is exactly 5x5.
      expect(dots.length).toBe(TOTAL_CELLS);

      // Each child is a dot cell.
      for (const dot of Array.from(dots)) {
        expect(dot.classList.contains("dmx-dot")).toBe(true);
      }

      // The cells WITHOUT `dmx-inactive` are the active pattern cells.
      const activeDots = Array.from(dots).filter(
        (dot) => !dot.classList.contains("dmx-inactive"),
      );
      expect(activeDots.length).toBe(getPatternIndexes(pattern).length);
    },
  );

  it("drives active dots through the path-wave resolver (--dmx-path var)", () => {
    const SnakeWave = createPathWaveComponent("SmokeSnakeWave", snakePathNormFromIndex);

    const { container } = render(<SnakeWave pattern="full" />);

    const grid = container.querySelector(".dmx-grid");
    expect(grid).not.toBeNull();

    const dots = grid!.querySelectorAll(".dmx-dot");
    expect(dots.length).toBe(TOTAL_CELLS);

    // For the "full" pattern every cell is active, so the path-wave resolver
    // sets the `--dmx-path` CSS variable on each active dot.
    const activeDots = Array.from(dots).filter(
      (dot) => !dot.classList.contains("dmx-inactive"),
    );
    expect(activeDots.length).toBe(getPatternIndexes("full").length);

    const pathDot = activeDots.find((dot) =>
      (dot as HTMLElement).style.getPropertyValue("--dmx-path") !== "",
    );
    expect(pathDot).toBeDefined();
  });
});
