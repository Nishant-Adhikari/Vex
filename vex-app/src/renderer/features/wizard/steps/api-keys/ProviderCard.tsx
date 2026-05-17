/**
 * ProviderCard — per-provider section primitive used by ApiKeysStep.
 *
 * Renders a glass-tinted card with:
 *   - 36×36 icon tile (slot — caller passes a brand SVG / `<img>`)
 *   - provider name + required/optional + Set/Partial/Not-set badges
 *   - description (ReactNode — caller can embed inline links / warnings)
 *   - optional "Get key" CTA-style link (target="_blank", rel="noopener
 *     noreferrer"; rendered with an up-right arrow glyph)
 *   - body slot (children) — the actual input or auto-setup button
 *
 * Kept generic on purpose: the four providers (Jupiter / Tavily /
 * Rettiwt / Polymarket) differ in iconography and CTA wiring, but the
 * outer chrome is identical so this primitive avoids a 4× duplication
 * inside ApiKeysStep (rule 18 — "stop duplication early").
 *
 * Visual contract:
 *   - card root: `rounded-2xl border-white/[0.06] bg-white/[0.02] p-4`,
 *     stack-spacing 3 (header / description / body).
 *   - icon tile: 36×36 rounded-xl, accent-tinted background derived
 *     from `var(--vex-onboarding-accent)`. Caller's icon should be ~20px.
 *   - badges: small inline pills with semantic palette tokens.
 *   - data attributes: `data-vex-apikeys-card` set from the `slug` prop
 *     so tests can address each card individually.
 */

import type { JSX, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../../../lib/utils.js";

export type ProviderCardSlug = "jupiter" | "tavily" | "rettiwt" | "polymarket";

export type ProviderCardStatusTone = "set" | "partial" | "unset";

export interface ProviderCardStatus {
  readonly tone: ProviderCardStatusTone;
  readonly label: string;
}

export interface ProviderCardGetKey {
  readonly url: string;
  readonly label: string;
}

export interface ProviderCardProps {
  readonly slug: ProviderCardSlug;
  readonly iconSlot: ReactNode;
  readonly name: string;
  readonly required?: boolean;
  readonly status: ProviderCardStatus;
  readonly description: ReactNode;
  readonly getKey?: ProviderCardGetKey;
  readonly children: ReactNode;
}

const CARD_CHROME = cn(
  "flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4",
);

const ICON_TILE_CHROME = cn(
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
  "bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_14%,transparent)]",
  "text-[var(--vex-onboarding-accent)]",
);

const BADGE_CHROME = cn(
  "inline-flex items-center rounded-full px-2 py-0.5",
  "font-mono text-[10px] uppercase tracking-[0.14em]",
);

function StatusPill({ status }: { status: ProviderCardStatus }): JSX.Element {
  const toneClass =
    status.tone === "set"
      ? "border border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] text-[var(--color-success)]"
      : status.tone === "partial"
        ? "border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)] text-[var(--color-warning)]"
        : "border border-white/[0.08] bg-white/[0.03] text-[var(--color-text-muted)]";
  return <span className={cn(BADGE_CHROME, toneClass)}>{status.label}</span>;
}

function RequiredPill(): JSX.Element {
  return (
    <span
      className={cn(
        BADGE_CHROME,
        "border border-[color-mix(in_oklab,var(--vex-onboarding-accent)_40%,transparent)]",
        "bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_12%,transparent)]",
        "text-[var(--vex-onboarding-accent)]",
      )}
    >
      Required
    </span>
  );
}

function OptionalPill(): JSX.Element {
  return (
    <span
      className={cn(
        BADGE_CHROME,
        "border border-white/[0.06] bg-white/[0.02] text-[var(--color-text-muted)]",
      )}
    >
      Optional
    </span>
  );
}

function GetKeyLink({ getKey }: { getKey: ProviderCardGetKey }): JSX.Element {
  return (
    <a
      href={getKey.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex w-fit items-center gap-1.5 text-xs font-medium",
        "text-[var(--vex-onboarding-accent)] transition-colors",
        "hover:text-[color-mix(in_oklab,var(--vex-onboarding-accent)_80%,white)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
      )}
    >
      {getKey.label}
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} aria-hidden />
    </a>
  );
}

export function ProviderCard({
  slug,
  iconSlot,
  name,
  required = false,
  status,
  description,
  getKey,
  children,
}: ProviderCardProps): JSX.Element {
  return (
    <section
      data-vex-apikeys-card={slug}
      aria-labelledby={`vex-apikeys-card-${slug}-name`}
      className={CARD_CHROME}
    >
      <header className="flex items-start gap-3">
        <span aria-hidden className={ICON_TILE_CHROME}>
          {iconSlot}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`vex-apikeys-card-${slug}-name`}
              className="text-sm font-semibold text-[var(--color-text-primary)]"
            >
              {name}
            </h3>
            {required ? <RequiredPill /> : <OptionalPill />}
            <StatusPill status={status} />
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {description}
          </p>
          {getKey ? <GetKeyLink getKey={getKey} /> : null}
        </div>
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
