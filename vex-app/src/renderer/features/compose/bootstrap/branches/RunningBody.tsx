/**
 * Branch: running — Docker Compose up is in flight. Hero dotmatrix
 * loader (`dotm-circular-8` — pulse bursts from center) anchors the
 * body; two service pills (Postgres + Embeddings) read aggregated
 * substate from the parsed log stream; a subordinate ghost Cancel
 * button lives in the body section (footer keeps the step counter
 * only — Continue only appears once the phase flips to `ready`).
 *
 * The hero loader downsizes on shorter viewports (1024×720 floor) so
 * the centerpiece never crowds the panel header / pills (codex plan
 * v2 SHOULD-FIX #4).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { DotmCircular8 } from "../../../../components/ui/dotm-circular-8.js";
import { DotmSquare3 } from "../../../../components/ui/dotm-square-3.js";
import { cn } from "../../../../lib/utils.js";
import type { AggregatedServiceState, ServiceStatus } from "../types.js";

interface RunningBodyProps {
  readonly services: AggregatedServiceState[];
  readonly onCancel: () => void;
  readonly cancelling: boolean;
}

const statusChrome: Record<ServiceStatus, string> = {
  starting:
    "border-white/[0.1] bg-white/[0.04] text-[var(--color-text-secondary)]",
  probing:
    "border-[color-mix(in_oklab,var(--vex-onboarding-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_8%,transparent)] text-[var(--vex-onboarding-accent)]",
  ready:
    "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)] text-[var(--color-success)]",
  failed:
    "border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]",
};

export function RunningBody({
  services,
  onCancel,
  cancelling,
}: RunningBodyProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative mt-2 flex h-[72px] w-[72px] items-center justify-center sm:h-[64px] sm:w-[64px] xl:h-[80px] xl:w-[80px]">
        <DotmCircular8
          size={64}
          color="var(--vex-onboarding-accent)"
          ariaLabel="Starting services"
        />
      </div>

      <p className="text-center text-xs uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">
        Starting Vex services
      </p>

      <ul className="flex w-full flex-col gap-2">
        {services.map((s) => (
          <li
            key={s.service}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
              statusChrome[s.status],
            )}
            data-service={s.service}
            data-status={s.status}
          >
            <DotmSquare3
              size={22}
              dotSize={3}
              animated={s.status === "starting" || s.status === "probing"}
              color={
                s.status === "ready"
                  ? "var(--color-success)"
                  : s.status === "failed"
                    ? "var(--color-danger)"
                    : "var(--vex-onboarding-accent)"
              }
              ariaLabel={`${s.service} ${s.status}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                {s.service}
              </span>
              <span className="truncate text-[11px] text-[var(--color-text-secondary)]">
                {s.detail}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] opacity-80">
              {s.status}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        {...(cancelling
          ? { "data-vex-compose-cancelling": "" }
          : { "data-vex-compose-cancel": "" })}
        className={cn(
          "inline-flex items-center gap-1.5 self-center rounded-md border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)] backdrop-blur-md",
          "hover:border-white/[0.2] hover:bg-white/[0.1] hover:text-[var(--color-text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "transition-colors duration-150",
        )}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </div>
  );
}
