/**
 * Polymarket auto-setup section (feature #7) — owns the
 * "Auto-configure Polymarket" CTA and the two-modal flow that backs it.
 *
 * Renders INSIDE the Polymarket provider card in `ApiKeysStep` as the
 * single repair / configure path. The manual trio entry was removed in
 * the PR8 redesign, so auto-setup is no longer a fallback — it is the
 * only renderer-visible way to write Polymarket credentials. Behaviour:
 *
 *   - status === "configured" → button reads "Reconfigure Polymarket".
 *     Clicking opens the confirm modal first (overwrite is destructive
 *     once the engine drops the old API key).
 *   - status === "partial"    → button reads
 *     "Auto-configure Polymarket (replaces partial entries)". Skips the
 *     confirm modal — the partial state is already invalid; auto-setup
 *     is the repair path.
 *   - status === "missing"    → button reads "Auto-configure Polymarket".
 *     Skips the confirm modal.
 *
 * Disabled gates:
 *   - EVM wallet missing → button disabled + inline helper.
 *   - Vault locked        → button disabled + inline helper.
 *   - `disabled` prop     → from parent form pending state.
 *
 * Race fallback (codex review #2): if the SudoModal IPC returns
 * `wallet.risk_confirmation_required` we close the sudo modal and
 * re-open the confirm modal. The parent state machine tolerates this
 * because the modal phase is owned here, not in the main process.
 *
 * On success the section invokes the parent's `onSuccess` callback so
 * the parent can invalidate the envState query and re-render the
 * status badge.
 */

import { useCallback, useState, type JSX } from "react";
import type {
  PolymarketAutoSetupResult,
  PolymarketStatus,
} from "@shared/schemas/api-keys.js";
import { Button } from "../../../../components/ui/button.js";
import { PolymarketConfirmModal } from "./PolymarketConfirmModal.js";
import { PolymarketSudoModal } from "./PolymarketSudoModal.js";

export interface PolymarketAutoSetupSectionProps {
  readonly status: PolymarketStatus;
  readonly evmWalletPresent: boolean;
  readonly vaultUnlocked: boolean;
  readonly disabled: boolean;
  readonly onSuccess: () => void;
}

type Phase = "idle" | "confirming" | "submitting";

function buttonLabelFor(status: PolymarketStatus): string {
  switch (status) {
    case "configured":
      return "Reconfigure Polymarket";
    case "partial":
      return "Auto-configure Polymarket (replaces partial entries)";
    case "missing":
      return "Auto-configure Polymarket";
  }
}

export function PolymarketAutoSetupSection({
  status,
  evmWalletPresent,
  vaultUnlocked,
  disabled,
  onSuccess,
}: PolymarketAutoSetupSectionProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle");
  const [overwriteConfirmed, setOverwriteConfirmed] = useState<boolean>(false);

  // Helper text below the button: explains WHY the button is disabled
  // when a precondition is missing. Skill §10 — every disabled control
  // must surface a reason.
  let helperText: string | null = null;
  if (!evmWalletPresent) {
    helperText = "EVM wallet required — finish Step 2 first.";
  } else if (!vaultUnlocked) {
    helperText = "Unlock Vex first.";
  }

  const buttonDisabled =
    disabled || !evmWalletPresent || !vaultUnlocked;

  const onClick = useCallback((): void => {
    if (buttonDisabled) return;
    if (status === "configured") {
      setOverwriteConfirmed(false);
      setPhase("confirming");
      return;
    }
    // partial + missing skip the confirm step — overwriteConfirmed
    // stays false because main does not require it when current state
    // is not "configured".
    setOverwriteConfirmed(false);
    setPhase("submitting");
  }, [buttonDisabled, status]);

  const onConfirmAccept = useCallback((): void => {
    setOverwriteConfirmed(true);
    setPhase("submitting");
  }, []);

  const onConfirmClose = useCallback((): void => {
    setPhase("idle");
    setOverwriteConfirmed(false);
  }, []);

  const onSudoSuccess = useCallback(
    (_result: PolymarketAutoSetupResult): void => {
      setPhase("idle");
      setOverwriteConfirmed(false);
      onSuccess();
    },
    [onSuccess],
  );

  const onSudoClose = useCallback((): void => {
    setPhase("idle");
    setOverwriteConfirmed(false);
  }, []);

  const onSudoRiskConfirmationRequired = useCallback((): void => {
    // Race fallback: main reports it never saw overwriteConfirmed.
    // Drop back to the confirm modal so the user can re-acknowledge,
    // then the second sudo attempt will carry overwriteConfirmed:true.
    setPhase("confirming");
  }, []);

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-popover/40 p-3"
      data-vex-polymarket-auto="root"
    >
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={onClick}
        disabled={buttonDisabled}
        data-vex-polymarket-auto-button
        data-vex-polymarket-auto-status={status}
      >
        {buttonLabelFor(status)}
      </Button>
      {helperText !== null ? (
        <p
          className="text-xs text-muted-foreground"
          data-vex-polymarket-auto-helper
        >
          {helperText}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Auto-setup uses your EVM wallet to authenticate with Polymarket
          and stores the derived API credentials in your local vault. No
          secret is shown on screen.
        </p>
      )}

      {phase === "confirming" ? (
        <PolymarketConfirmModal
          onConfirm={onConfirmAccept}
          onClose={onConfirmClose}
        />
      ) : null}

      {phase === "submitting" ? (
        <PolymarketSudoModal
          overwriteConfirmed={overwriteConfirmed}
          onSuccess={onSudoSuccess}
          onClose={onSudoClose}
          onRiskConfirmationRequired={onSudoRiskConfirmationRequired}
        />
      ) : null}
    </div>
  );
}
