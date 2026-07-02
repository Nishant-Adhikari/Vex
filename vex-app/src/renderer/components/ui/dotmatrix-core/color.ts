import type { DotMatrixColorPreset } from "./types.js";

const DOT_MATRIX_COLOR_PRESETS: Record<
  DotMatrixColorPreset,
  {
    fill: string;
    glow: string;
  }
> = {
  "solid-theme": {
    fill: "var(--color-dot-on)",
    glow: "var(--color-dot-on)"
  },
  "solid-mint": {
    fill: "#34d399",
    glow: "#34d399"
  },
  // The brand gradient — the landing cobalt family (#7d92ff periwinkle on
  // dark → #1f44ff accent → #0a23b8 deep). The ONLY gradient preset in the
  // single-accent design language; everything in-brand loads in cobalt.
  "grad-cobalt": {
    fill: "linear-gradient(140deg, #7d92ff 0%, #1f44ff 48%, #0a23b8 100%)",
    glow: "#1f44ff"
  },
  "grad-sunset": {
    fill: "linear-gradient(135deg, #ff5f6d 0%, #ffc371 52%, #ffe29a 100%)",
    glow: "#ff8b73"
  },
  "grad-ocean": {
    fill: "linear-gradient(140deg, #00c6ff 0%, #0072ff 48%, #4facfe 100%)",
    glow: "#2f8fff"
  },
  "grad-neon": {
    fill: "linear-gradient(145deg, #b4ff39 0%, #39ffb6 46%, #00d4ff 100%)",
    glow: "#59ffc8"
  },
  "grad-aurora": {
    fill: "linear-gradient(145deg, #ff3cac 0%, #784ba0 45%, #2b86c5 100%)",
    glow: "#9c64bf"
  },
  "grad-fire": {
    fill: "linear-gradient(145deg, #ff512f 0%, #dd2476 45%, #ffb347 100%)",
    glow: "#f96a5f"
  },
  "grad-prism": {
    fill: "linear-gradient(145deg, #12c2e9 0%, #c471ed 45%, #f64f59 100%)",
    glow: "#9e7de8"
  }
};

export function resolveDmxColorTokens(color: string, colorPreset?: DotMatrixColorPreset): {
  resolvedColor: string;
  dotFill: string;
} {
  if (!colorPreset) {
    return { resolvedColor: color, dotFill: color };
  }

  const preset = DOT_MATRIX_COLOR_PRESETS[colorPreset];
  if (!preset) {
    return { resolvedColor: color, dotFill: color };
  }

  return { resolvedColor: preset.glow, dotFill: preset.fill };
}
