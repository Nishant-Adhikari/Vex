/**
 * Shared review summary primitive (M11).
 *
 * Each domain card under `cards/` uses this to render the same
 * label / status / children / Edit-button layout. Pulling the layout
 * out keeps every domain card under ~70 LOC and prevents drift
 * between cards (e.g. one renders the Edit button at the top, another
 * at the bottom — confusing operator UX during finalize review).
 */

import type { JSX, ReactNode } from "react";
import { Button } from "../../../../../components/ui/button.js";

export type SummaryStatus = "ok" | "missing" | "partial" | "warning" | "info";

const STATUS_DOT: Record<SummaryStatus, string> = {
  ok: "bg-emerald-500",
  missing: "bg-rose-500",
  partial: "bg-amber-500",
  warning: "bg-amber-500",
  info: "bg-slate-400",
};

export interface SummaryCardProps {
  readonly title: string;
  readonly status: SummaryStatus;
  readonly statusLabel: string;
  readonly children?: ReactNode;
  readonly onEdit?: () => void;
  readonly editDisabled?: boolean;
  readonly testId?: string;
}

export function SummaryCard({
  title,
  status,
  statusLabel,
  children,
  onEdit,
  editDisabled = false,
  testId,
}: SummaryCardProps): JSX.Element {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-card/40 p-3"
      data-vex-review-card={testId}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
          />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
          {onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEdit}
              disabled={editDisabled}
            >
              Edit
            </Button>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="text-xs text-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}
