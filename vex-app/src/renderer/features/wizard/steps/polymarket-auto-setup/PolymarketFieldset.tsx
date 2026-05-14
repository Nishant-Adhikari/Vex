/**
 * PolymarketFieldset — composes the auto-setup action (PolymarketAutoSetupSection)
 * with the manual entry trio (API key / secret / passphrase) and the inline
 * status indicator. Extracted from ApiKeysStep to keep that file focused on
 * step-level orchestration (form submit, skip-card, navigation) rather than
 * per-provider widget composition.
 *
 * Owns no submit logic itself — the parent step reads the manual fields via
 * the ref objects passed down on `refs` and includes them in its IPC payload.
 */

import type { JSX, Ref } from "react";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import { Label } from "../../../../components/ui/label.js";
import { PasswordField } from "../../../../components/common/PasswordField.js";
import { PolymarketAutoSetupSection } from "./PolymarketAutoSetupSection.js";

export interface PolymarketFieldsetRefs {
  readonly polymarketKey: Ref<HTMLInputElement>;
  readonly polymarketSecret: Ref<HTMLInputElement>;
  readonly polymarketPassphrase: Ref<HTMLInputElement>;
}

export interface PolymarketFieldsetProps {
  readonly refs: PolymarketFieldsetRefs;
  readonly polymarketStatus: PolymarketStatus;
  readonly evmWalletPresent: boolean;
  readonly vaultUnlocked: boolean;
  readonly disabled: boolean;
  readonly onAutoSetupSuccess: () => void;
}

export function PolymarketFieldset({
  refs,
  polymarketStatus,
  evmWalletPresent,
  vaultUnlocked,
  disabled,
  onAutoSetupSuccess,
}: PolymarketFieldsetProps): JSX.Element {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      data-vex-apikeys-polymarket="fieldset"
    >
      <legend className="px-1 text-sm font-medium">
        Polymarket{" "}
        <span className="text-xs text-muted-foreground">
          (optional — auto-setup or all three manual fields)
        </span>
      </legend>
      <PolymarketAutoSetupSection
        status={polymarketStatus}
        evmWalletPresent={evmWalletPresent}
        vaultUnlocked={vaultUnlocked}
        disabled={disabled}
        onSuccess={onAutoSetupSuccess}
      />
      <div
        className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground"
        aria-hidden
      >
        <span className="h-px flex-1 bg-border" />
        <span>or enter manually</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="vex-apikey-poly-key">API key</Label>
        <PasswordField
          id="vex-apikey-poly-key"
          autoComplete="new-password"
          ref={refs.polymarketKey}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="vex-apikey-poly-secret">API secret</Label>
        <PasswordField
          id="vex-apikey-poly-secret"
          autoComplete="new-password"
          ref={refs.polymarketSecret}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="vex-apikey-poly-pass">Passphrase</Label>
        <PasswordField
          id="vex-apikey-poly-pass"
          autoComplete="new-password"
          ref={refs.polymarketPassphrase}
        />
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-vex-apikeys-polymarket-status
      >
        Status:{" "}
        {polymarketStatus === "configured"
          ? "Set ✓"
          : polymarketStatus === "partial"
            ? "Partial — repair above"
            : "Not set"}
      </p>
    </fieldset>
  );
}
