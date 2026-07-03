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
  // The brand gradient — the landing cobalt family (#7d92ff periwinkle on
  // dark → #1f44ff accent → #0a23b8 deep). The ONLY gradient preset in the
  // single-accent design language; everything in-brand loads in cobalt.
  "grad-cobalt": {
    fill: "linear-gradient(140deg, #7d92ff 0%, #1f44ff 48%, #0a23b8 100%)",
    glow: "#1f44ff"
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
