/**
 * Portfolio equity curve — a Robinhood-shaped area/line of total wallet value
 * over time. Pure + presentational: it takes an already-derived point series
 * ({ t, totalUsd } oldest→newest) and draws a single trend-coloured line over a
 * faint filled area, with a dotted "period open" baseline and an end dot.
 *
 * Hand-rolled SVG (no chart lib) to match the desk's other charts. The line
 * fills the full width via `preserveAspectRatio="none"` with
 * `vector-effect="non-scaling-stroke"` so the stroke stays crisp while the x
 * axis stretches. Value scaling is data-relative (not zero-based) — an equity
 * curve reads by its own high/low, like Robinhood's.
 */

import type { JSX } from "react";

export interface SeriesPoint {
  readonly t: string;
  readonly totalUsd: number;
}

const VB_W = 1000;
const PAD_Y = 12;

/** SVG geometry for the series in a `VB_W`×`height` viewBox (data-relative Y). */
function geometry(
  points: readonly SeriesPoint[],
  height: number,
): { line: string; area: string; baselineY: number; end: { x: number; y: number } } | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p.totalUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max === min ? 1 : max - min;
  const innerH = height - PAD_Y * 2;
  const n = points.length;
  const x = (i: number): number => (n === 1 ? VB_W / 2 : (i / (n - 1)) * VB_W);
  const y = (v: number): number => PAD_Y + innerH * (1 - (v - min) / span);

  const coords = points.map((p, i) => `${round(x(i))},${round(y(p.totalUsd))}`);
  const line = coords.join(" ");
  const area =
    `M ${coords[0]} L ${coords.slice(1).join(" L ")} ` +
    `L ${VB_W},${height} L 0,${height} Z`;
  return {
    line,
    area,
    baselineY: y(values[0] ?? 0),
    end: { x: x(n - 1), y: y(values[values.length - 1] ?? 0) },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function PortfolioChart({
  points,
  height = 200,
}: {
  readonly points: readonly SeriesPoint[];
  readonly height?: number;
}): JSX.Element {
  const geo = geometry(points, height);

  if (geo === null) {
    return (
      <div
        className="flex items-center justify-center rounded-[6px] border border-dashed border-[var(--vex-line)] text-xs text-[var(--vex-text-3)]"
        style={{ height }}
      >
        Not enough history yet — value curve fills in as wallets sync.
      </div>
    );
  }

  // The equity curve is always drawn green — the desk keeps the portfolio line
  // on-brand (never red), regardless of whether the range closed up or down.
  const stroke = "var(--color-success)";

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Total wallet value over time"
      className="block"
    >
      <path d={geo.area} fill={stroke} opacity={0.08} />
      {/* Period-open baseline — the dotted "where you started" reference. */}
      <line
        x1={0}
        y1={geo.baselineY}
        x2={VB_W}
        y2={geo.baselineY}
        stroke="var(--vex-line-strong)"
        strokeWidth={1}
        strokeDasharray="2 4"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={geo.line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={geo.end.x} cy={geo.end.y} r={3.5} fill={stroke} />
    </svg>
  );
}
