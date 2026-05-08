/**
 * Single row in the System Check list. Status icon + label + optional
 * detail line (collapsible later — M2 minimum is render).
 */

import { type ReactNode } from "react";
import { cn } from "../../lib/utils.js";

export type StepStatus = "loading" | "ok" | "warn" | "fail";

interface StepRowProps {
  readonly label: string;
  readonly status: StepStatus;
  readonly detail: string | null;
}

const statusToBadge: Record<StepStatus, string> = {
  loading: "bg-muted-foreground/40",
  ok: "bg-success",
  warn: "bg-warning",
  fail: "bg-destructive",
};

const statusToText: Record<StepStatus, string> = {
  loading: "checking…",
  ok: "ok",
  warn: "warn",
  fail: "fail",
};

const statusToTextColor: Record<StepStatus, string> = {
  loading: "text-muted-foreground",
  ok: "text-success",
  warn: "text-warning",
  fail: "text-destructive",
};

export function StepRow({ label, status, detail }: StepRowProps): JSX.Element {
  return (
    <li
      className="flex items-center gap-3 rounded-md border border-border bg-popover/40 px-3 py-2 text-sm motion-cascade-row"
      data-step-status={status}
    >
      <Dot status={status} />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-foreground">{label}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
      <span
        className={cn(
          "rounded-full bg-popover/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
          statusToTextColor[status]
        )}
      >
        {statusToText[status]}
      </span>
    </li>
  );
}

function Dot({ status }: { readonly status: StepStatus }): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        statusToBadge[status],
        status === "loading" ? "animate-pulse" : undefined
      )}
    />
  );
}
