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
import { Tavily, X } from "@thesvg/react";
import { type WizardStepId } from "@shared/schemas/wizard.js";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import { Button } from "../../../components/ui/button.js";
import { Label } from "../../../components/ui/label.js";
import { PasswordField } from "../../../components/common/PasswordField.js";
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
import {
  ProviderCard,
  type ProviderCardStatus,
} from "./api-keys/ProviderCard.js";
import { PolymarketAutoSetupSection } from "./polymarket-auto-setup/PolymarketAutoSetupSection.js";

export interface ApiKeysStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

const POLYMARKET_PARTIAL_MESSAGE =
  "Polymarket has only some credentials saved. Use auto-configure to repair before continuing.";

function statusFor(configured: boolean): ProviderCardStatus {
  return configured
    ? { tone: "set", label: "Set ✓" }
    : { tone: "unset", label: "Not set" };
}

function polymarketStatusBadge(status: PolymarketStatus): ProviderCardStatus {
  switch (status) {
    case "configured":
      return { tone: "set", label: "Set ✓" };
    case "partial":
      return { tone: "partial", label: "Partial" };
    case "missing":
      return { tone: "unset", label: "Not set" };
  }
}

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
    const polymarketNotConfigured = polymarketStatus !== "configured";
    return (
      <WizardStepPanel
        panelDataAttr={{ kind: "apikeys", value: "skip" }}
        icon={meta.icon}
        title="API keys already configured"
        description="Vex found your JUPITER_API_KEY in this install. Continue to keep using it. You can review or edit the optional integrations (Tavily, Rettiwt, Polymarket) from the Review step before finishing."
        footer={
          <Button
            onClick={() => {
              void onSkipContinue();
            }}
            disabled={stepAdvance.isPending}
          >
            {stepAdvance.isPending ? "Continuing…" : "Continue"}
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
                  setFormError(null);
                  setSkipExpanded(true);
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
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void onSkipContinue();
            }}
            disabled={submitting || stepAdvance.isPending}
          >
            Skip optional
          </Button>
          <Button type="submit" disabled={submitting || stepAdvance.isPending}>
            {submitting || stepAdvance.isPending
              ? "Saving…"
              : flowMode === "back-edit"
                ? "Save and return to review"
                : "Save and continue"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Jupiter — required, brand mark as PNG (decorative; the card
            header h3 carries the accessible name). */}
        <ProviderCard
          slug="jupiter"
          iconSlot={
            <img
              src="/logo/jupiter.png"
              alt=""
              aria-hidden
              draggable={false}
              className="h-6 w-6 object-contain"
            />
          }
          name="Jupiter"
          required
          status={statusFor(jupiterConfigured)}
          description={
            <>
              Required for Solana swap + portfolio tools. Free API key —
              open the portal, then{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                Settings → API Keys → + Create new API key
              </span>
              .
            </>
          }
          getKey={{
            url: "https://portal.jup.ag/",
            label: "Open Jupiter Portal",
          }}
        >
          <Label htmlFor="vex-apikey-jupiter" className="sr-only">
            Jupiter API key
          </Label>
          <PasswordField
            id="vex-apikey-jupiter"
            autoFocus
            autoComplete="new-password"
            ref={refs.jupiter}
          />
          <p className="text-xs text-[var(--color-text-muted)]">
            {jupiterConfigured
              ? "Leave blank to keep, or paste a new key to overwrite."
              : "Required to continue."}
          </p>
        </ProviderCard>

        {/* Tavily — optional, web research. Free tier: 1,000 q/month. */}
        <ProviderCard
          slug="tavily"
          iconSlot={<Tavily width={20} height={20} aria-hidden />}
          name="Tavily"
          status={statusFor(tavilyConfigured)}
          description={
            <>
              Extends your agent with web research / search. Free tier:{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                1,000 queries / month
              </span>
              . Open the dashboard, then click the{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                +
              </span>{" "}
              next to API Keys.
            </>
          }
          getKey={{
            url: "https://app.tavily.com/home",
            label: "Open Tavily dashboard",
          }}
        >
          <Label htmlFor="vex-apikey-tavily" className="sr-only">
            Tavily API key
          </Label>
          <PasswordField
            id="vex-apikey-tavily"
            autoComplete="new-password"
            ref={refs.tavily}
          />
        </ProviderCard>

        {/* Rettiwt — optional, X / Twitter account tool. The key is a
            base64-encoded session cookie, so the user-facing risk is
            account-suspension, not API-quota. We point at the two
            extension stores inline. */}
        <ProviderCard
          slug="rettiwt"
          iconSlot={<X width={18} height={18} aria-hidden />}
          name="Rettiwt (X / Twitter)"
          status={statusFor(rettiwtConfigured)}
          description={
            <>
              Unlocks the X (Twitter) account tool. The key is your X
              session cookie, so use a{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                secondary X account
              </span>{" "}
              — Vex keeps the key encrypted locally, but X may still flag
              automation activity (~1 in 100k risk). Sign in in an
              incognito window, then click the extension to generate the
              key. It stays valid for 5 years from login.
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <a
              href="https://chromewebstore.google.com/detail/x-auth-helper/igpkhkjmpdecacocghpgkghdcmcmpfhp"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--vex-onboarding-accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
            >
              Chrome: X Auth Helper ↗
            </a>
            <span aria-hidden className="text-[var(--color-text-muted)]">
              ·
            </span>
            <a
              href="https://addons.mozilla.org/en-US/firefox/addon/rettiwt-auth-helper"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--vex-onboarding-accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
            >
              Firefox: Rettiwt Auth Helper ↗
            </a>
          </div>
          <Label htmlFor="vex-apikey-rettiwt" className="sr-only">
            Rettiwt API key
          </Label>
          <PasswordField
            id="vex-apikey-rettiwt"
            autoComplete="new-password"
            ref={refs.rettiwt}
          />
        </ProviderCard>

        {/* Polymarket — optional, auto-setup only. Manual trio entry
            removed in PR8 redesign. Partial-state repair is the same
            auto-setup button (PolymarketAutoSetupSection switches to
            "replaces partial entries" label). Card root preserves the
            `data-vex-apikeys-polymarket="fieldset"` test selector. */}
        {polymarketPartial ? (
          <div
            role="alert"
            data-vex-apikeys-warning="polymarket-partial"
            className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] p-3 text-sm text-[var(--color-warning)]"
          >
            <strong className="font-semibold">
              Polymarket needs all three credentials.
            </strong>{" "}
            One or two are already saved. Use auto-configure below to
            repair the partial state.
          </div>
        ) : null}

        <div data-vex-apikeys-polymarket="fieldset">
          <ProviderCard
            slug="polymarket"
            iconSlot={
              <img
                src="/logo/polymarket.png"
                alt=""
                aria-hidden
                draggable={false}
                className="h-6 w-6 object-contain"
              />
            }
            name="Polymarket"
            status={polymarketStatusBadge(polymarketStatus)}
            description={
              <>
                Prediction-market trading. Auto-setup derives CLOB API
                credentials from your EVM wallet — no manual key entry,
                nothing shown on screen. Replaces partial state in-place.
              </>
            }
          >
            <PolymarketAutoSetupSection
              status={polymarketStatus}
              evmWalletPresent={evmWalletPresent}
              vaultUnlocked={vaultUnlocked}
              disabled={submitting || stepAdvance.isPending}
              onSuccess={invalidateEnvState}
            />
          </ProviderCard>
        </div>

        {formError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </WizardStepPanel>
  );
}
