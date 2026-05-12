import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { SummaryCard } from "./SummaryCard.js";

export interface ModeCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
}

export function ModeCard({
  envState,
  onEdit,
  editDisabled,
}: ModeCardProps): JSX.Element {
  const m = envState.mode;
  const status = m.coherent ? "ok" : "missing";
  const value = m.selected ?? "—";
  const detailParts: string[] = [];
  if (m.selected === "mission") {
    detailParts.push(`loop: ${m.loopMode ?? "—"}`);
    detailParts.push(`prompt: ${m.hasInitialPrompt ? "set" : "missing"}`);
  } else if (m.selected === "full_autonomous" && m.hasInitialPrompt) {
    detailParts.push("seed prompt set");
  }
  return (
    <SummaryCard
      title="Mode"
      status={status}
      statusLabel={status === "ok" ? value : "Incomplete"}
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="mode"
    >
      {detailParts.length > 0 ? detailParts.join(" · ") : null}
    </SummaryCard>
  );
}
