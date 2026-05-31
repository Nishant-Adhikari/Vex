import type { JSX } from "react";
import { cn } from "../../lib/utils.js";

/**
 * ShinyText — gradient-clipped text with a silver→white shine sweep.
 *
 * The animation lives entirely in globals.css (`.vex-shiny-text` +
 * `@keyframes vex-shine`) as build-time CSS, so it stays CSP-safe under
 * `style-src 'self'` (no inline styles, no motion/react). Adapted from the
 * motion/react ShinyText snippet supplied in the UI/UX brief; the visual
 * (silver base #b5b5b5 → white shine #ffffff, ~2s left sweep) is preserved.
 *
 * Reduced-motion users get static, readable silver text via the global
 * prefers-reduced-motion handling in globals.css.
 */
export function ShinyText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}): JSX.Element {
  return <span className={cn("vex-shiny-text", className)}>{text}</span>;
}
