/**
 * ApiKeysSkipPanel — the "already configured" skip surface of
 * ApiKeysStep.
 *
 * Rendered only in `first-pass` flow when JUPITER_API_KEY is set and
 * Polymarket is not partial (the `canSkip` gate lives in the parent).
 * Presentational: it owns no state. The parent passes the skip-continue
 * handler, the advance-pending flag, the current form error, the
 * Polymarket status (to decide whether to surface the "Configure
 * Polymarket now" CTA), and the CTA handler — which the parent wires to
 * clear the error then expand the skip-card into the full form.
 *
 * Markup, copy, data-attributes (`data-vex-apikeys-skip-polymarket-cta`),
 * accessibility (role="alert", focus-visible ring), and the
 * `panelDataAttr` forwarded to `WizardStepPanel` are preserved verbatim
 * from the inlined branch.
 */

import type { JSX, ReactNode } from "react";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import { Button } from "../../../../components/ui/button.js";
import { WizardStepPanel } from "../../WizardStepPanel.js";

export interface ApiKeysSkipPanelProps {
  readonly icon: ReactNode;
  readonly polymarketStatus: PolymarketStatus;
  readonly formError: string | null;
  readonly advancePending: boolean;
  readonly onContinue: () => void;
  readonly onConfigurePolymarket: () => void;
}

export function ApiKeysSkipPanel({
  icon,
  polymarketStatus,
  formError,
  advancePending,
  onContinue,
  onConfigurePolymarket,
}: ApiKeysSkipPanelProps): JSX.Element {
  const polymarketNotConfigured = polymarketStatus !== "configured";
  return (
    <WizardStepPanel
      panelDataAttr={{ kind: "apikeys", value: "skip" }}
      icon={icon}
      title="API keys already configured"
      description="Vex found your JUPITER_API_KEY in this install. Continue to keep using it. You can review or edit the optional integrations (Tavily, Rettiwt, Polymarket) from the Review step before finishing."
      footer={
        <Button
          onClick={() => {
            onContinue();
          }}
          disabled={advancePending}
        >
          {advancePending ? "Continuing…" : "Continue"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {formError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {formError}
          </p>
        ) : null}
        {polymarketNotConfigured ? (
          <p
            className="text-sm text-[var(--color-text-secondary)]"
            data-vex-apikeys-skip-polymarket-cta="container"
          >
            Want to enable Polymarket trading?{" "}
            <button
              type="button"
              onClick={() => {
                onConfigurePolymarket();
              }}
              className="font-medium text-[var(--vex-onboarding-accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
              data-vex-apikeys-skip-polymarket-cta="button"
            >
              Configure Polymarket now
            </button>
            .
          </p>
        ) : null}
      </div>
    </WizardStepPanel>
  );
}
