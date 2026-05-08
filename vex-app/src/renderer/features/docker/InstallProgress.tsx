/**
 * Live install/download progress strip. Subscribes to
 * `vex.docker.onInstallProgress` and renders the most recent payload —
 * the renderer never tries to keep a long log of progress lines (the
 * main process is the source of truth, skill §11).
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">
          {phase}
        </span>
        {percent !== null ? (
          <span className="font-mono text-foreground">{percent}%</span>
        ) : null}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-popover">
        <div
          className={cn(
            "h-full transition-[width]",
            isFailure ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: percent !== null ? `${percent}%` : "33%" }}
        />
      </div>
      {progress?.message ? (
        <p className="text-xs text-muted-foreground">{progress.message}</p>
      ) : null}
    </div>
  );
}
