/**
 * Wizard Step 3 — API keys (M9 + feature #7 Polymarket auto-setup +
 * PR8 redesign — per-provider glass cards).
 *
 * Stores the optional API keys via `vex.onboarding.apiKeysSet`. Per
 * skill §14: secret inputs are uncontrolled DOM refs, plain-async
 * submit, refs cleared synchronously after firing the IPC. Per-field
 * status badges derive from envState booleans only — values never
 * round-trip.
 *
 * The Polymarket manual trio is no longer captured by this form;
 * `PolymarketAutoSetupSection` is the only path that writes Polymarket
 * credentials from this step. The IPC schema (`apiKeysSetInputSchema`)
 * still accepts `polymarket` for potential programmatic callers — that
 * surface lives at the boundary, not in the UI.
 *
 * Skip-card semantics (codex turn 1 D3 + feature #7 Q5):
 *   - Step 3 is "configured" iff JUPITER_API_KEY is set AND the
 *     Polymarket status is NOT "partial". Partial blocks the skip and
 *     surfaces a warning callout above the Polymarket card.
 *   - Skip-card is ONLY shown in `first-pass` flow mode. In `back-edit`
 *     mode (user clicked Edit from Review) we always render the full
 *     form so they can change anything.
 *   - In setup mode the skip-card surfaces a "Configure Polymarket now"
 *     CTA when polymarketStatus !== "configured" so the operator can
 *     run feature #7 auto-setup without going through Settings.
 *
 * Polymarket repair path (partial state): the only renderer-visible
 * repair is the auto-configure button inside the Polymarket card —
 * Settings has no clear/repair flow today, so we do not promise one.
 *
 * Chrome lives in `WizardStepPanel` — `data-vex-wizard-apikeys`
 * forwarded onto the panel root via typed `panelDataAttr`. Polymarket
 * partial warning and the skip-card CTA keep their own
 * `data-vex-apikeys-*` attributes for test stability.
 */

import { useCallback, useRef, useState, type JSX } from "react";
import { type WizardStepId } from "@shared/schemas/wizard.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import {
  setApiKeys,
  useInvalidateEnvStateAfterApiKeysWrite,
} from "../../../lib/api/api-keys.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";
import { WIZARD_STEP_META } from "../wizard-icons.js";
import { WizardStepPanel } from "../WizardStepPanel.js";
import {
  buildPayload,
  clearAll,
  type FieldRefs,
} from "./api-keys/form-helpers.js";
import { statusFor, polymarketStatusBadge } from "./api-keys/status-helpers.js";
import { ApiKeysSkipPanel } from "./api-keys/ApiKeysSkipPanel.js";
import { ApiKeysFormFooter } from "./api-keys/ApiKeysFormFooter.js";
import {
  JupiterCard,
  TavilyCard,
  RettiwtCard,
  PolymarketCard,
} from "./api-keys/ProviderCards.js";

export interface ApiKeysStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

const POLYMARKET_PARTIAL_MESSAGE =
  "Polymarket has only some credentials saved. Use auto-configure to repair before continuing.";

export function ApiKeysStep({
  completedSteps,
  onAdvance,
  flowMode,
}: ApiKeysStepProps): JSX.Element {
  const envQuery = useEnvState();
  const stepAdvance = useStepAdvance();
  const invalidateEnvState = useInvalidateEnvStateAfterApiKeysWrite();

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedOnce, setSubmittedOnce] = useState(false);
  // Feature #7 Q5: in setup mode, skip-card can be "opened" to reveal
  // the full form (so the operator can run auto-setup without first
  // visiting Settings). The flag stays local — refetching envState
  // does not reset it.
  const [skipExpanded, setSkipExpanded] = useState(false);

  const refs: FieldRefs = {
    jupiter: useRef<HTMLInputElement | null>(null),
    tavily: useRef<HTMLInputElement | null>(null),
    rettiwt: useRef<HTMLInputElement | null>(null),
  };

  const envState = envQuery.data?.ok === true ? envQuery.data.data : null;
  const apiKeysState = envState?.apiKeys ?? null;
  const jupiterConfigured = apiKeysState?.jupiterConfigured ?? false;
  const tavilyConfigured = apiKeysState?.tavilyConfigured ?? false;
  const rettiwtConfigured = apiKeysState?.rettiwtConfigured ?? false;
  const polymarketStatus = apiKeysState?.polymarketStatus ?? "missing";
  const polymarketPartial = polymarketStatus === "partial";
  // Feature #7 inputs: the auto-setup IPC needs an EVM keystore and an
  // unlocked vault. Both come from envState; the section disables its
  // button (with helper text) when either is missing.
  const evmWalletPresent = envState?.walletStatus.evm === "present";
  const vaultUnlocked = envState?.secrets.unlocked ?? false;
  // Feature #7 Q5: back-edit ALWAYS renders the full form. In setup
  // mode the skip-card stays available unless the operator clicked the
  // "Configure Polymarket now" CTA (skipExpanded === true).
  const canSkip =
    flowMode === "first-pass"
    && jupiterConfigured
    && !polymarketPartial
    && !submittedOnce
    && !skipExpanded;

  const advanceToEmbedding = useCallback(async () => {
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "apiKeys",
      forwardNext: "embedding",
      onAdvance,
    });
    if (!result.ok) setFormError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setFormError(null);
      const payload = buildPayload(refs);
      // Same required-state guards as the Skip button (codex DRIFT
      // turn 9): empty Save when Jupiter is not yet configured must
      // not advance; partial Polymarket in env requires auto-setup
      // repair before continuing (manual repair path is gone).
      if (!jupiterConfigured && payload.jupiterApiKey === undefined) {
        setFormError(
          "Jupiter API key is required for Solana trading. Enter it before continuing.",
        );
        return;
      }
      if (polymarketPartial) {
        setFormError(POLYMARKET_PARTIAL_MESSAGE);
        return;
      }
      // Snapshot the payload, clear the inputs SYNCHRONOUSLY before
      // the await, then fire IPC. Matches M8 wallet-import contract.
      clearAll(refs);
      setSubmitting(true);
      try {
        const result = await setApiKeys(payload);
        if (!result.ok) {
          setFormError(result.error.message);
          return;
        }
        invalidateEnvState();
        setSubmittedOnce(true);
        await advanceToEmbedding();
      } finally {
        setSubmitting(false);
      }
    },
    [
      advanceToEmbedding,
      invalidateEnvState,
      refs,
      jupiterConfigured,
      polymarketPartial,
    ],
  );

  const onSkipContinue = useCallback(async () => {
    setFormError(null);
    if (!jupiterConfigured && !submittedOnce) {
      setFormError(
        "Jupiter API key is required for Solana trading. Enter it before skipping the optional ones.",
      );
      return;
    }
    if (polymarketPartial) {
      setFormError(POLYMARKET_PARTIAL_MESSAGE);
      return;
    }
    await advanceToEmbedding();
  }, [advanceToEmbedding, jupiterConfigured, polymarketPartial, submittedOnce]);

  const meta = WIZARD_STEP_META.apiKeys;

  if (canSkip) {
    return (
      <ApiKeysSkipPanel
        icon={meta.icon}
        polymarketStatus={polymarketStatus}
        formError={formError}
        advancePending={stepAdvance.isPending}
        onContinue={() => {
          void onSkipContinue();
        }}
        onConfigurePolymarket={() => {
          setFormError(null);
          setSkipExpanded(true);
        }}
      />
    );
  }

  return (
    <WizardStepPanel
      panelDataAttr={{ kind: "apikeys", value: "form" }}
      icon={meta.icon}
      title="Connect your API keys"
      description="Jupiter is required for Solana trading. The optional keys (Tavily, Rettiwt, Polymarket) unlock specific tools later. Keys are stored on this machine in your local config and sent only to the matching provider when you invoke a tool that needs them."
      formProps={{
        onSubmit: (e) => {
          void onSubmit(e);
        },
        noValidate: true,
      }}
      footer={
        <ApiKeysFormFooter
          flowMode={flowMode}
          submitting={submitting}
          advancePending={stepAdvance.isPending}
          onSkip={() => {
            void onSkipContinue();
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <JupiterCard
          status={statusFor(jupiterConfigured)}
          configured={jupiterConfigured}
          inputRef={refs.jupiter}
        />

        <TavilyCard
          status={statusFor(tavilyConfigured)}
          inputRef={refs.tavily}
        />

        <RettiwtCard
          status={statusFor(rettiwtConfigured)}
          inputRef={refs.rettiwt}
        />

        <PolymarketCard
          status={polymarketStatusBadge(polymarketStatus)}
          polymarketStatus={polymarketStatus}
          polymarketPartial={polymarketPartial}
          evmWalletPresent={evmWalletPresent}
          vaultUnlocked={vaultUnlocked}
          disabled={submitting || stepAdvance.isPending}
          onSuccess={invalidateEnvState}
        />

        {formError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </WizardStepPanel>
  );
}
