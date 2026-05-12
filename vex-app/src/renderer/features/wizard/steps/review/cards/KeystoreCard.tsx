import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { SummaryCard } from "./SummaryCard.js";

export interface KeystoreCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
}

export function KeystoreCard({
  envState,
  onEdit,
  editDisabled,
}: KeystoreCardProps): JSX.Element {
  const ok = envState.hasKeystorePassword;
  return (
    <SummaryCard
      title="Master password"
      status={ok ? "ok" : "missing"}
      statusLabel={ok ? "Configured" : "Missing"}
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="keystore"
    >
      {ok
        ? "Stored locally; never leaves this machine."
        : "Required to encrypt wallet keystores."}
    </SummaryCard>
  );
}
