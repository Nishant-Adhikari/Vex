import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { SummaryCard } from "./SummaryCard.js";

export interface EmbeddingCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
}

export function EmbeddingCard({
  envState,
  onEdit,
  editDisabled,
}: EmbeddingCardProps): JSX.Element {
  const e = envState.embeddings;
  const status = e.allFieldsConfigured ? "ok" : "missing";
  return (
    <SummaryCard
      title="Embedding"
      status={status}
      statusLabel={
        status === "ok"
          ? e.reachable
            ? "Configured · reachable"
            : "Configured · not reachable"
          : "Not configured"
      }
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="embedding"
    >
      <span>Endpoint: {e.baseUrlRedacted ?? "—"}</span>
    </SummaryCard>
  );
}
