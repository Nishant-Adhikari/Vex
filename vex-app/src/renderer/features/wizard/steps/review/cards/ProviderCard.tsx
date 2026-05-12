import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { SummaryCard } from "./SummaryCard.js";

export interface ProviderCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
}

export function ProviderCard({
  envState,
  onEdit,
  editDisabled,
}: ProviderCardProps): JSX.Element {
  const p = envState.provider;
  return (
    <SummaryCard
      title="Inference provider"
      status={p.configured ? "ok" : "missing"}
      statusLabel={p.configured ? p.name ?? "configured" : "Not configured"}
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="provider"
    >
      {p.configured && p.modelLabel ? <span>Model: {p.modelLabel}</span> : null}
    </SummaryCard>
  );
}
