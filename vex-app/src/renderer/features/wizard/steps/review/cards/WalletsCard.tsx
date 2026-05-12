import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { SummaryCard } from "./SummaryCard.js";

export interface WalletsCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
}

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletsCard({
  envState,
  onEdit,
  editDisabled,
}: WalletsCardProps): JSX.Element {
  const evmOk = envState.walletStatus.evm === "present";
  const solOk = envState.walletStatus.solana === "present";
  const status = evmOk && solOk ? "ok" : evmOk || solOk ? "partial" : "missing";
  const evmAddr = envState.walletAddresses?.evm ?? null;
  const solAddr = envState.walletAddresses?.solana ?? null;
  return (
    <SummaryCard
      title="Wallets"
      status={status}
      statusLabel={
        status === "ok" ? "Both chains" : status === "partial" ? "Partial" : "Missing"
      }
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="wallets"
    >
      <div className="flex flex-col gap-1">
        <span>EVM: {evmOk ? shortAddr(evmAddr) : "missing"}</span>
        <span>Solana: {solOk ? shortAddr(solAddr) : "missing"}</span>
      </div>
    </SummaryCard>
  );
}
