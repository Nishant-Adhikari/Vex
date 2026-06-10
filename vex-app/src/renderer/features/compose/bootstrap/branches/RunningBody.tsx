/**
 * Branch: running — Docker Compose up is in flight. Hero dotmatrix
 * loader (`dotm-circular-8` — pulse bursts from center) anchors the
 * body; the two services (Postgres + Embeddings) render as NOTARY
 * ledger rows reading aggregated substate from the parsed log stream;
 * a subordinate quiet Cancel button closes the body (the armed
 * CONTINUE key appears only once the phase flips to `ready`).
 *
 * The `data-vex-compose-cancel` / `data-vex-compose-cancelling`
 * attribute pair on the Cancel button is a public test contract (PR3
 * cancellation) — do not rename.
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

/** Status ink for the row's mono stamp text + matrix color. */
const statusInk: Record<ServiceStatus, string> = {
  starting: "text-[var(--color-text-secondary)]",
  probing: "text-[var(--vex-onboarding-accent)]",
  ready: "text-[var(--color-success)]",
  failed: "text-[var(--color-danger)]",
};

const matrixColor: Record<ServiceStatus, string> = {
  starting: "var(--vex-onboarding-accent)",
  probing: "var(--vex-onboarding-accent)",
  ready: "var(--color-success)",
  failed: "var(--color-danger)",
};

export function RunningBody({
  services,
  onCancel,
  cancelling,
}: RunningBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {/* HERO — the machine at work, centered above the ledger. */}
      <div className="flex justify-center pt-2">
        <DotmCircular8
          size={64}
          color="var(--vex-onboarding-accent)"
          ariaLabel="Starting services"
        />
      </div>

      {/* SERVICE LEDGER — one hairline row per service; the heavier
       * bottom border is the closing rule. */}
      <ul className="flex w-full flex-col border-b border-white/[0.10]">
        {services.map((s, i) => (
          <li
            key={s.service}
            className="flex items-center gap-3 border-b border-white/[0.06] py-4"
            data-service={s.service}
            data-status={s.status}
          >
            <span
              aria-hidden
              className="w-7 shrink-0 font-mono text-[10px] tabular-nums tracking-[0.1em] text-[var(--color-text-muted)]"
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                {s.service}
              </span>
              <span className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                {s.detail}
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <DotmSquare3
                size={16}
                dotSize={2}
                animated={s.status === "starting" || s.status === "probing"}
                color={matrixColor[s.status]}
                ariaLabel={`${s.service} ${s.status}`}
              />
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.2em]",
                  statusInk[s.status],
                )}
              >
                {s.status}
              </span>
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
          "inline-flex items-center gap-1.5 self-center rounded-[3px] border border-white/[0.12] bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]",
          "hover:border-white/[0.2] hover:text-[var(--color-text-primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-onboarding-bg)]",
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
