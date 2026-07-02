/**
 * Polymarket auto-setup section (feature #7 + puzzle 5 B-UI per-wallet) —
 * owns the EVM wallet picker, the "Auto-configure / Reconfigure" CTA, and
 * the two-modal flow that backs it.
 *
 * Renders INSIDE the Polymarket provider card in `ApiKeysStep` as the
 * single repair / configure path. The manual trio entry was removed in
 * the PR8 redesign, so auto-setup is the only renderer-visible way to write
 * Polymarket credentials.
 *
 * Per-wallet (B-UI): a picker lists every EVM wallet from the config-backed
 * inventory (`useAvailableWallets`) with a ✓ configured / ◦ not badge derived
 * from `useConfiguredPolymarketAddresses()`. The selection defaults to the
 * primary (first EVM). The CTA targets the SELECTED wallet and threads its
 * `walletId` into the IPC call.
 *
 * Overwrite gate (per selected wallet):
 *   - selected wallet CONFIGURED → button reads "Reconfigure Polymarket";
 *     clicking opens the confirm modal first (overwrite is destructive once
 *     the engine drops the old API key).
 *   - NOT configured + global status "partial" → button reads
 *     "Auto-configure Polymarket (replaces partial entries)"; skips confirm
 *     (the partial fixed-trio state is already invalid; auto-setup repairs).
 *   - NOT configured otherwise → "Auto-configure Polymarket"; skips confirm.
 *
 * Disabled gates (unchanged): EVM wallet missing → disabled + helper; vault
 * locked → disabled + helper; `disabled` prop from parent pending state.
 *
 * Race fallback (codex review #2): if the SudoModal IPC returns
 * `wallet.risk_confirmation_required` we re-open the confirm modal. The main
 * handler re-checks per-wallet under the env-write lock, so a stale renderer
 * "configured" view self-heals.
 *
 * On success the section invalidates the configured-addresses query (so the
 * picker badge refreshes) and invokes the parent's `onSuccess` callback (so
 * the parent can invalidate envState + re-render the aggregate status badge).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  PolymarketAutoSetupResult,
  PolymarketStatus,
} from "@shared/schemas/api-keys.js";
import type { AvailableWalletDto } from "@shared/schemas/wallets.js";
import { Button } from "../../../../components/ui/button.js";
import { useAvailableWallets } from "../../../../lib/api/wallet-inventory.js";
import { useConfiguredPolymarketAddresses } from "../../../../lib/api/polymarket.js";
import { onboardingKeys } from "../../../../lib/api/queryKeys.js";
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

function shortAddress(address: string): string {
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function buttonLabelFor(
  selectedWalletConfigured: boolean,
  status: PolymarketStatus,
): string {
  if (selectedWalletConfigured) return "Reconfigure Polymarket";
  if (status === "partial") {
    return "Auto-configure Polymarket (replaces partial entries)";
  }
  return "Auto-configure Polymarket";
}

export function PolymarketAutoSetupSection({
  status,
  evmWalletPresent,
  vaultUnlocked,
  disabled,
  onSuccess,
}: PolymarketAutoSetupSectionProps): JSX.Element {
  const queryClient = useQueryClient();
  const walletsQuery = useAvailableWallets();
  const configuredQuery = useConfiguredPolymarketAddresses();

  const [phase, setPhase] = useState<Phase>("idle");
  const [overwriteConfirmed, setOverwriteConfirmed] = useState<boolean>(false);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);

  const evmWallets: readonly AvailableWalletDto[] = useMemo(
    () =>
      walletsQuery.data?.ok === true ? walletsQuery.data.data.evm : [],
    [walletsQuery.data],
  );

  // Lowercased addresses with Polymarket creds already configured.
  const configuredSet: ReadonlySet<string> = useMemo(() => {
    if (configuredQuery.data?.ok !== true) return new Set<string>();
    return new Set(
      configuredQuery.data.data.addresses.map((a) => a.toLowerCase()),
    );
  }, [configuredQuery.data]);

  // Default the selection to the primary (first EVM). Re-resolve if the
  // currently-selected id disappears from the inventory (e.g. wallet removed).
  useEffect(() => {
    if (evmWallets.length === 0) {
      if (selectedWalletId !== null) setSelectedWalletId(null);
      return;
    }
    const stillPresent = evmWallets.some((w) => w.id === selectedWalletId);
    if (!stillPresent) {
      setSelectedWalletId(evmWallets[0]?.id ?? null);
    }
  }, [evmWallets, selectedWalletId]);

  const selectedWallet = useMemo(
    () => evmWallets.find((w) => w.id === selectedWalletId) ?? null,
    [evmWallets, selectedWalletId],
  );

  const selectedWalletConfigured =
    selectedWallet !== null &&
    configuredSet.has(selectedWallet.address.toLowerCase());

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
    disabled || !evmWalletPresent || !vaultUnlocked || selectedWallet === null;

  const onClick = useCallback((): void => {
    if (buttonDisabled) return;
    if (selectedWalletConfigured) {
      // Selected wallet already has creds → destructive overwrite path.
      setOverwriteConfirmed(false);
      setPhase("confirming");
      return;
    }
    // Not configured (incl. partial fixed-trio repair) → skip confirm.
    setOverwriteConfirmed(false);
    setPhase("submitting");
  }, [buttonDisabled, selectedWalletConfigured]);

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
      // Refresh the per-wallet badge, then let the parent refresh envState.
      void queryClient.invalidateQueries({
        queryKey: onboardingKeys.polymarketConfiguredAddresses(),
      });
      onSuccess();
    },
    [onSuccess, queryClient],
  );

  const onSudoClose = useCallback((): void => {
    setPhase("idle");
    setOverwriteConfirmed(false);
  }, []);

  const onSudoRiskConfirmationRequired = useCallback((): void => {
    // Race fallback: main reports it never saw overwriteConfirmed for the
    // selected wallet. Drop back to the confirm modal so the user can
    // re-acknowledge; the second sudo attempt carries overwriteConfirmed:true.
    setPhase("confirming");
  }, []);

  const walletsLoading = walletsQuery.isPending;

  return (
    // Hairline inner well — luminance step + hairline (landing ink grammar).
    <div
      className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"
      data-vex-polymarket-auto="root"
    >
      {/* EVM wallet picker — per-wallet ✓ configured / ◦ not badge. */}
      <fieldset
        className="flex flex-col gap-1.5"
        data-vex-polymarket-auto-picker="root"
        disabled={disabled}
      >
        <legend className="text-xs font-medium text-muted-foreground">
          EVM wallet
        </legend>
        {walletsLoading ? (
          <p
            className="text-xs text-muted-foreground"
            data-vex-polymarket-auto-picker="loading"
          >
            Loading wallets…
          </p>
        ) : evmWallets.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-vex-polymarket-auto-picker="empty"
          >
            No EVM wallet found.
          </p>
        ) : (
          evmWallets.map((wallet) => {
            const isConfigured = configuredSet.has(
              wallet.address.toLowerCase(),
            );
            const isSelected = wallet.id === selectedWalletId;
            return (
              <label
                key={wallet.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-white/[0.08] px-2 py-1.5 text-sm hover:bg-white/[0.04] has-[:checked]:border-[color-mix(in_oklab,var(--color-accent-primary)_55%,transparent)] has-[:checked]:bg-[color-mix(in_oklab,var(--color-accent-primary)_8%,transparent)]"
                data-vex-polymarket-auto-wallet={wallet.id}
                data-vex-polymarket-auto-wallet-selected={
                  isSelected ? "true" : "false"
                }
                data-vex-polymarket-auto-wallet-configured={
                  isConfigured ? "true" : "false"
                }
              >
                <input
                  type="radio"
                  name="vex-polymarket-auto-wallet"
                  value={wallet.id}
                  checked={isSelected}
                  onChange={() => setSelectedWalletId(wallet.id)}
                  className="h-4 w-4 accent-[var(--color-accent-primary)]"
                  data-vex-polymarket-auto-wallet-radio={wallet.id}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{wallet.label}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {shortAddress(wallet.address)}
                  </span>
                </span>
                <span
                  className={
                    isConfigured
                      ? "shrink-0 text-xs font-medium text-[var(--color-success)]"
                      : "shrink-0 text-xs text-muted-foreground"
                  }
                  aria-label={
                    isConfigured
                      ? "Polymarket configured"
                      : "Polymarket not configured"
                  }
                >
                  {isConfigured ? "✓ Configured" : "◦ Not configured"}
                </span>
              </label>
            );
          })
        )}
      </fieldset>

      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={onClick}
        disabled={buttonDisabled}
        data-vex-polymarket-auto-button
        data-vex-polymarket-auto-status={status}
        data-vex-polymarket-auto-selected-configured={
          selectedWalletConfigured ? "true" : "false"
        }
      >
        {buttonLabelFor(selectedWalletConfigured, status)}
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
          Auto-setup uses the selected EVM wallet to authenticate with
          Polymarket and stores the derived API credentials in your local
          vault. No secret is shown on screen.
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
          walletId={selectedWalletId ?? undefined}
          overwriteConfirmed={overwriteConfirmed}
          onSuccess={onSudoSuccess}
          onClose={onSudoClose}
          onRiskConfirmationRequired={onSudoRiskConfirmationRequired}
        />
      ) : null}
    </div>
  );
}
