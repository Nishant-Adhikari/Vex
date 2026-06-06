/**
 * Shared types + display constants for the ExportPrivateKeyModal split.
 *
 * `Chain`/`Phase` and the chain label map were lifted verbatim from
 * `ExportPrivateKeyModal.tsx` so the local hook and the presentational
 * subcomponents share one definition (no duplication, no behavior change).
 */

export type Chain = "evm" | "solana";

export type Phase = "idle" | "copied" | "cleared" | "closing";

export const CHAIN_LABEL: Record<Chain, string> = {
  evm: "EVM",
  solana: "Solana",
};
