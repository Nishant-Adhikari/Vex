/**
 * Per-step DotMatrix loader signature — every wizard step has its own
 * SHAPE × PATTERN pairing so the horizontal stepper gives each step a
 * distinct visual identity instead of seven identical dots.
 *
 * Landing rebrand: ALL seven steps speak the single cobalt accent
 * family — `solid-theme` (flat accent via `--color-dot-on`) or
 * `grad-cobalt` (periwinkle → cobalt → deep, the one sanctioned
 * gradient). Steps are differentiated by geometry, not rainbow color:
 * Hex for embedding (vector lattice), Circular for wallets/agentCore
 * (loop / cycle), Square spirals with distinct dot patterns (full /
 * rings / diamond / outline) for the rest.
 */

import type { ComponentType } from "react";

import { DotmCircular8 } from "../../../components/ui/dotm-circular-8.js";
import { DotmHex3 } from "../../../components/ui/dotm-hex-3.js";
import { DotmSquare3 } from "../../../components/ui/dotm-square-3.js";
import type {
  DotMatrixColorPreset,
  DotMatrixCommonProps,
  MatrixPattern,
} from "../../../components/ui/dotmatrix-core.js";
import type { WizardStepId } from "@shared/schemas/wizard.js";

export interface StepperLoaderVariant {
  readonly Component: ComponentType<DotMatrixCommonProps>;
  readonly colorPreset: DotMatrixColorPreset;
  /**
   * Dot pattern override — meaningful for the Square3 spiral only
   * (Circular8 masks its own disc; Hex3 draws a custom lattice).
   */
  readonly pattern?: MatrixPattern;
}

export const STEPPER_LOADER_VARIANTS: Readonly<
  Record<WizardStepId, StepperLoaderVariant>
> = {
  keystore: { Component: DotmSquare3, colorPreset: "solid-theme" },
  wallets: { Component: DotmCircular8, colorPreset: "grad-cobalt" },
  apiKeys: {
    Component: DotmSquare3,
    colorPreset: "grad-cobalt",
    pattern: "rings",
  },
  embedding: { Component: DotmHex3, colorPreset: "grad-cobalt" },
  agentCore: { Component: DotmCircular8, colorPreset: "solid-theme" },
  provider: {
    Component: DotmSquare3,
    colorPreset: "solid-theme",
    pattern: "diamond",
  },
  review: {
    Component: DotmSquare3,
    colorPreset: "grad-cobalt",
    pattern: "outline",
  },
};
