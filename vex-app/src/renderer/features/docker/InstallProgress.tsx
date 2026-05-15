/**
 * Live install/download progress strip. Subscribes to
 * `vex.docker.onInstallProgress` and renders the most recent payload —
 * the renderer never tries to keep a long log of progress lines (the
 * main process is the source of truth, skill §11).
 *
 * Embedded inside the BootstrapPanel glass card (no surrounding card
 * frame), replacing the status tile while `desktop_download` is in
 * flight. The bar respects reduced motion (CSS transition-width is
 * disabled via the global media query).
 */

import { useEffect, useState } from "react";
import type { InstallProgress } from "@shared/schemas/docker.js";
import { cn } from "../../lib/utils.js";

interface InstallProgressProps {
  readonly active: boolean;
}

export function InstallProgressStrip({ active }: InstallProgressProps): JSX.Element | null {
  const [progress, setProgress] = useState<InstallProgress | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }
    const off = window.vex.docker.onInstallProgress(setProgress);
    return () => off();
  }, [active]);

  if (!active && progress === null) return null;

  const percent = progress?.percent ?? null;
  const phase = progress?.phase ?? "starting";
  const isFailure = phase === "failed";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
          {phase}
        </span>
        {percent !== null ? (
          <span className="font-mono tabular-nums text-[var(--color-text-primary)]">
            {percent}%
          </span>
        ) : null}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-inset ring-white/[0.06]">
        <div
          className={cn(
            "h-full transition-[width] duration-150 ease-out",
            isFailure
              ? "bg-[var(--color-danger)]"
              : "bg-[var(--dockerbootstrap-accent,var(--color-accent-primary))]",
          )}
          style={{ width: percent !== null ? `${percent}%` : "33%" }}
        />
      </div>
      {progress?.message ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
          {progress.message}
        </p>
      ) : null}
    </div>
  );
}
