/**
 * Post-submit status banners for the export-private-key modal: the "copied —
 * scrub in {N}s" amber banner (phase === "copied") and the "scrub attempted —
 * closing" emerald banner (phase === "cleared" | "closing").
 *
 * Extracted verbatim from `ExportPrivateKeyModal.tsx`. Purely presentational:
 * it shows only the countdown integer — never any secret material.
 */

import type { JSX } from "react";
import type { Phase } from "./types.js";

export interface ExportPrivateKeyBannersProps {
  readonly phase: Phase;
  readonly clearCountdown: number;
}

export function ExportPrivateKeyBanners({
  phase,
  clearCountdown,
}: ExportPrivateKeyBannersProps): JSX.Element {
  return (
    <>
      {phase === "copied" ? (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
          role="status"
          data-vex-export-status="copied"
        >
          Copied. Clipboard will be scrubbed in {clearCountdown}s.
        </p>
      ) : null}

      {phase === "cleared" || phase === "closing" ? (
        <p
          className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400"
          role="status"
          data-vex-export-status="cleared"
        >
          Vex attempted to scrub the clipboard. This window will close shortly.
        </p>
      ) : null}
    </>
  );
}
