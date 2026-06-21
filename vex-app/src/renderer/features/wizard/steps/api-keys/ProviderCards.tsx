/**
 * ApiKeysStep provider-card bodies — the four `ProviderCard` instances
 * rendered inside the step form (Jupiter / Tavily / Rettiwt / Polymarket).
 *
 * Each component owns the per-provider chrome (icon, copy, external
 * links, status badge) and forwards the parent-owned uncontrolled secret
 * ref into the `PasswordField` for the three keyed providers. The
 * Polymarket body hosts `PolymarketAutoSetupSection` only (PR8 redesign
 * — no manual trio). Markup, copy, hrefs, `data-vex-apikeys-card`
 * selectors, accessibility (sr-only labels, aria-hidden icons), and the
 * Polymarket partial-warning callout are preserved verbatim from the
 * inlined cards.
 *
 * Presentational: no state, no IPC of their own. Status badges come from
 * the parent (which derives them via `status-helpers`); secret values
 * stay in the parent's refs and never enter these modules' scope.
 */

import type { JSX, RefObject } from "react";
import { Tavily, X } from "@thesvg/react";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import { Label } from "../../../../components/ui/label.js";
import { PasswordField } from "../../../../components/common/PasswordField.js";
import { PolymarketAutoSetupSection } from "../polymarket-auto-setup/PolymarketAutoSetupSection.js";
import { ProviderCard, type ProviderCardStatus } from "./ProviderCard.js";

export interface JupiterCardProps {
  readonly status: ProviderCardStatus;
  readonly configured: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

export function JupiterCard({
  status,
  configured,
  inputRef,
}: JupiterCardProps): JSX.Element {
  return (
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
      status={status}
      description={
        <>
          Needed for Solana token swaps + portfolio tools — optional, add it
          later in Settings (Solana swaps stay unavailable until you do). Free
          API key — open the portal, then{" "}
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
        ref={inputRef}
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        {configured
          ? "Leave blank to keep, or paste a new key to overwrite."
          : "Optional — leave blank to add later; Solana swaps stay unavailable until you set it."}
      </p>
    </ProviderCard>
  );
}

export interface TavilyCardProps {
  readonly status: ProviderCardStatus;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

export function TavilyCard({
  status,
  inputRef,
}: TavilyCardProps): JSX.Element {
  return (
    <ProviderCard
      slug="tavily"
      iconSlot={<Tavily width={20} height={20} aria-hidden />}
      name="Tavily"
      status={status}
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
        ref={inputRef}
      />
    </ProviderCard>
  );
}

export interface RettiwtCardProps {
  readonly status: ProviderCardStatus;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

export function RettiwtCard({
  status,
  inputRef,
}: RettiwtCardProps): JSX.Element {
  return (
    <ProviderCard
      slug="rettiwt"
      iconSlot={<X width={18} height={18} aria-hidden />}
      name="Rettiwt (X / Twitter)"
      status={status}
      description={
        <>
          Unlocks the X (Twitter) account tool. The key is your X session
          cookie, so use a{" "}
          <span className="font-medium text-[var(--color-text-primary)]">
            secondary X account
          </span>{" "}
          — Vex keeps the key encrypted locally, but X may still flag
          automation activity (~1 in 100k risk). Sign in in an incognito
          window, then click the extension to generate the key. It stays
          valid for 5 years from login.
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
        ref={inputRef}
      />
    </ProviderCard>
  );
}

export interface PolymarketCardProps {
  readonly status: ProviderCardStatus;
  readonly polymarketStatus: PolymarketStatus;
  readonly polymarketPartial: boolean;
  readonly evmWalletPresent: boolean;
  readonly vaultUnlocked: boolean;
  readonly disabled: boolean;
  readonly onSuccess: () => void;
}

export function PolymarketCard({
  status,
  polymarketStatus,
  polymarketPartial,
  evmWalletPresent,
  vaultUnlocked,
  disabled,
  onSuccess,
}: PolymarketCardProps): JSX.Element {
  return (
    <>
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
          One or two are already saved. Use auto-configure below to repair
          the partial state.
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
          status={status}
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
            disabled={disabled}
            onSuccess={onSuccess}
          />
        </ProviderCard>
      </div>
    </>
  );
}
