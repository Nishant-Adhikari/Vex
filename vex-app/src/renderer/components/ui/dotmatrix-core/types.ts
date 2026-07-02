import type { CSSProperties } from "react";

export type MatrixPattern = "diamond" | "full" | "outline" | "rose" | "cross" | "rings";
export type DotShape = "circle" | "square" | "diamond" | "hearts";
export type DotMatrixPhase = "idle" | "collapse" | "hoverRipple" | "loadingRipple";
export type DotMatrixColorPreset =
  | "solid-theme"
  | "solid-mint"
  | "grad-cobalt"
  | "grad-sunset"
  | "grad-ocean"
  | "grad-neon"
  | "grad-aurora"
  | "grad-fire"
  | "grad-prism";

export interface DotMatrixCommonProps {
  size?: number;
  dotSize?: number;
  color?: string;
  colorPreset?: DotMatrixColorPreset;
  speed?: number;
  ariaLabel?: string;
  className?: string;
  pattern?: MatrixPattern;
  muted?: boolean;
  /**
   * Adds a glow on dots from opacity 0.6 (weakest) through 1 (strongest), after remapping.
   */
  bloom?: boolean;
  /** Uniform glow on every active dot (0…1); slightly wider falloff than selective `bloom`. */
  halo?: number;
  animated?: boolean;
  hoverAnimated?: boolean;
  dotClassName?: string;
  dotShape?: DotShape;
  opacityBase?: number;
  opacityMid?: number;
  opacityPeak?: number;
  cellPadding?: number;
  boxSize?: number;
  minSize?: number;
}

export interface DotAnimationContext {
  index: number;
  row: number;
  col: number;
  distanceFromCenter: number;
  angleFromCenter: number;
  radiusNormalized: number;
  manhattanDistance: number;
  phase: DotMatrixPhase;
  isActive: boolean;
  reducedMotion: boolean;
}

export interface DotAnimationState {
  className?: string;
  style?: CSSProperties;
}

export type DotAnimationResolver = (ctx: DotAnimationContext) => DotAnimationState;
