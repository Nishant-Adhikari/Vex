import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { SummaryCard } from "./SummaryCard.js";

export interface WakeCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
}

export function WakeCard({
  envState,
  onEdit,
  editDisabled,
}: WakeCardProps): JSX.Element {
  const w = envState.wake;
  const status = w.coherent ? "ok" : "missing";
  let detail: string;
  if (!w.coherent) {
    detail = "Incomplete configuration";
  } else if (w.enabled) {
    detail = `enabled · ${w.intervalMs} ms · batch ${w.batchSize}`;
  } else {
    detail = "disabled";
  }
  return (
    <SummaryCard
      title="Wake executor"
      status={status}
      statusLabel={detail}
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="wake"
    />
  );
}
