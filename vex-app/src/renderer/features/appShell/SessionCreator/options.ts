/**
 * Static option catalogues for the New-session modal mode/permission
 * radio grids (extracted from `SessionCreator.tsx`). Each option mirrors a
 * value from the IPC session schema discriminated union and carries the
 * presentational copy the {@link RadioCard} renders — including the
 * spec-sheet ordinal ("01"/"02") of the landing's numbered-card grammar
 * (typographic marks instead of an icon library).
 */

import type {
  SessionMode,
  SessionPermission,
} from "@shared/schemas/sessions.js";

export interface ModeOption {
  readonly value: SessionMode;
  /** Spec-sheet ordinal — the landing numbers everything ("01"–"08"). */
  readonly index: string;
  readonly title: string;
  readonly description: string;
}

export const MODE_OPTIONS: ReadonlyArray<ModeOption> = [
  {
    value: "agent",
    index: "01",
    title: "Agent",
    description: "One-shot conversation. Vex stays in chat, no loop.",
  },
  {
    value: "mission",
    index: "02",
    title: "Mission",
    description:
      "Goal-driven loop. Vex pursues a target and can self-schedule wakes.",
  },
];

export interface PermissionOption {
  readonly value: SessionPermission;
  /** Spec-sheet ordinal — the landing numbers everything ("01"–"08"). */
  readonly index: string;
  readonly title: string;
  readonly description: string;
  /**
   * Caution register: when selected, the consequence line speaks the pin
   * amber (--vex-pin) — the landing's needs-review color. Only the
   * "Full access" grant carries it. Definite boolean (not optional) so the
   * catalogue satisfies exactOptionalPropertyTypes at the RadioCard prop.
   */
  readonly caution: boolean;
}

export const PERMISSION_OPTIONS: ReadonlyArray<PermissionOption> = [
  {
    value: "restricted",
    index: "01",
    title: "Restricted",
    description: "Every mutating transaction requires your approval.",
    caution: false,
  },
  {
    value: "full",
    index: "02",
    title: "Full access",
    description: "Auto-execute approved tools without prompting per call.",
    caution: true,
  },
];
