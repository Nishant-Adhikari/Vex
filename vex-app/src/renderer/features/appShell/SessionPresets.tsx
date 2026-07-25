/**
 * SESSION PRESETS — the rail body shown when the sidebar's PRESETS tab is
 * active (in place of the session list). Each card is a one-click launcher for
 * a pre-written mission template: clicking it CREATES a mission session and
 * seeds the EXISTING new-mission draft flow, then opens the mission contract
 * modal so the operator lands one tap from Accept + Run.
 *
 * The launch reuses the exact hand-off `SessionCreator` performs — it does not
 * invent a parallel draft path:
 *   1. `useCreateSession` mutation → a mission session (permission from the
 *      preset; wallets left null so the backend applies the primary trading
 *      wallet, same as a normal new mission). The preset's structured `draft`
 *      rides along as `missionDraftSeed`; main seeds the mission contract from
 *      it (validated pipeline) so no field renders "Still Missing".
 *   2. `setPendingFirstMessage` hands the preset goal to the new session's
 *      composer, which submits it and generates the mission draft.
 *   3. `setReviewModal("mission")` opens the contract screen (MissionRail owns
 *      the modal; it mounts for the now-active mission session and shows
 *      "preparing" until the draft is ready).
 *
 * It NEVER auto-accepts or auto-runs: the host still reviews and signs the
 * contract. Trust boundary: 100% renderer presentation over existing hooks +
 * the ui store — no new IPC, no main/DB/wallet imports.
 */

import { useCallback, useState } from "react";
import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  Coins01Icon,
  DollarCircleIcon,
  FlashIcon,
  PlayIcon,
  Target02Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import type { SessionCreateInput } from "@shared/schemas/sessions.js";
import { cn } from "../../lib/utils.js";
import { useCreateSession } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { MISSION_PRESETS, type MissionPreset } from "./missionPresets.js";

/** A scannable parameter chip derived from the preset's contract metadata. */
interface PresetChip {
  readonly key: string;
  readonly icon: IconSvgElement;
  readonly label: string;
}

/** `60 → "1h"`, `90 → "1h 30m"`, `45 → "45m"` — compact time-box copy. */
function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Surface the preset's key constraints as at-a-glance chips instead of burying
 * them in prose. Pure over the preset's existing metadata (`constraints` +
 * `draft`) — no data change, just a scannable projection for the card.
 */
function derivePresetChips(preset: MissionPreset): readonly PresetChip[] {
  const chips: PresetChip[] = [
    {
      key: "cap",
      icon: DollarCircleIcon,
      label: `$${preset.constraints.spendCapUsd} cap`,
    },
    {
      key: "duration",
      icon: Timer01Icon,
      label: formatDuration(preset.constraints.durationMinutes),
    },
  ];
  const chain = preset.draft.allowedChains?.[0];
  if (chain !== undefined && chain.length > 0) {
    chips.push({ key: "chain", icon: Coins01Icon, label: chain });
  }
  if (preset.permission === "full") {
    chips.push({ key: "autonomy", icon: FlashIcon, label: "Full autonomy" });
  }
  return chips;
}

export function SessionPresets(): JSX.Element {
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const setPendingFirstMessage = useUiStore((s) => s.setPendingFirstMessage);
  const setReviewModal = useUiStore((s) => s.setReviewModal);
  const setSigningState = useUiStore((s) => s.setSigningState);
  const createMutation = useCreateSession();

  // The preset whose launch is in flight (disables just that card) + a shared
  // error line if creation fails.
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const handleLaunch = useCallback(
    async (preset: MissionPreset): Promise<void> => {
      if (launchingId !== null) return;
      setLaunchError(null);
      setLaunchingId(preset.id);
      // Mirror SessionCreator's signing-stroke choreography for the create
      // mutation. Wallets are null → backend applies the default (primary)
      // trading wallet, the same as a normal new mission; missions never
      // surface a secondary wallet.
      const input: SessionCreateInput = {
        mode: "mission",
        name: preset.title,
        permission: preset.permission,
        selectedEvmWalletId: null,
        selectedSolanaWalletId: null,
        // Authoritative structured contract seed — main applies it to the
        // mission draft right after create so every field renders filled
        // instead of "Still Missing".
        missionDraftSeed: preset.draft,
      };
      setSigningState("signing");
      try {
        const outcome = await createMutation.mutateAsync(input);
        if (!outcome.ok) {
          setSigningState("idle");
          setLaunchError(outcome.error.message);
          setLaunchingId(null);
          return;
        }
        setSigningState("signed");
        // Same composer hand-off SessionCreator uses: the goal is submitted as
        // the new session's first message, which generates the mission draft.
        setPendingFirstMessage({
          sessionId: outcome.data.id,
          message: preset.goal,
        });
        setActiveSessionId(outcome.data.id);
        // Land on the session view, then open the contract screen so the
        // operator is one tap from Accept + Run. The preset does NOT accept or
        // run — the host signs the contract itself.
        setAppShellView("session");
        setReviewModal("mission");
        setLaunchingId(null);
      } catch (error: unknown) {
        setSigningState("idle");
        setLaunchingId(null);
        setLaunchError(
          error instanceof Error ? error.message : "Could not launch preset.",
        );
      }
    },
    [
      createMutation,
      launchingId,
      setActiveSessionId,
      setAppShellView,
      setPendingFirstMessage,
      setReviewModal,
      setSigningState,
    ],
  );

  return (
    <div className="flex flex-col gap-2.5 px-1" data-vex-area="session-presets">
      <p className="px-1 pb-0.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--vex-text-3)]">
        One-click missions
      </p>
      <ul className="flex flex-col gap-2.5">
        {MISSION_PRESETS.map((preset) => {
          const launching = launchingId === preset.id;
          const chips = derivePresetChips(preset);
          return (
            <li key={preset.id}>
              <button
                type="button"
                disabled={launchingId !== null}
                onClick={() => {
                  void handleLaunch(preset);
                }}
                data-preset-id={preset.id}
                data-preset-card
                aria-label={`Launch preset: ${preset.title}`}
                className={cn(
                  // A LAUNCH SLIP, not a ledger row: a raised, accent-tinted
                  // card (gradient fill + accent border) that reads as a
                  // template you can fire — deliberately unlike the box-less,
                  // hairline-separated 48px session rows in the list.
                  "group relative flex w-full flex-col gap-3 overflow-hidden rounded-xl text-left",
                  "border border-[var(--vex-accent-border)] bg-gradient-to-b from-[var(--vex-accent-fill-12)] to-[var(--vex-accent-fill-8)] px-3.5 pb-3 pt-3.5",
                  "transition-[transform,border-color,box-shadow] duration-150",
                  "hover:-translate-y-px hover:border-[var(--vex-accent-border-strong)] hover:shadow-[0_8px_24px_-12px_var(--vex-accent-fill-12)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-surface-0)]",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {/* Header: accent icon chip + title, with a TEMPLATE marker so
                    it is unmistakably a launchable preset, not a past run. */}
                <span className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-12)] text-[var(--vex-accent-text)]"
                    >
                      <HugeiconsIcon icon={Target02Icon} size={16} />
                    </span>
                    <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-[var(--vex-text)]">
                      {preset.title}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-[var(--vex-accent-border)] px-2 py-[3px] font-mono text-[8.5px] uppercase leading-none tracking-[0.16em] text-[var(--vex-accent-text)]">
                    Template
                  </span>
                </span>

                {/* One-line intent — supporting copy, now that the params live
                    in chips below rather than in this sentence. */}
                <span className="text-xs leading-relaxed text-[var(--vex-text-3)]">
                  {preset.description}
                </span>

                {/* Scannable param chips: cap · time-box · chain · autonomy. */}
                <span
                  className="flex flex-wrap gap-1.5"
                  data-preset-chips
                >
                  {chips.map((chip) => (
                    <span
                      key={chip.key}
                      data-preset-chip={chip.key}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--vex-line)] bg-[var(--vex-surface-0)]/40 px-1.5 py-1 font-mono text-[10px] leading-none tracking-[0.02em] text-[var(--vex-text-2)]"
                    >
                      <HugeiconsIcon
                        icon={chip.icon}
                        size={11}
                        className="text-[var(--vex-accent-text)]"
                        aria-hidden
                      />
                      {chip.label}
                    </span>
                  ))}
                </span>

                {/* Explicit launch affordance: a full-width control that fills
                    to solid accent on hover/focus so the card obviously fires a
                    NEW mission. While launching it shows the contract prep. */}
                <span
                  data-preset-launch
                  className={cn(
                    "mt-0.5 flex items-center justify-between rounded-lg border border-[var(--vex-accent-border)] px-3 py-2 transition-colors",
                    launching
                      ? "bg-[var(--vex-accent-fill-12)]"
                      : "bg-[var(--vex-accent-fill-8)] group-hover:border-[var(--vex-accent)] group-hover:bg-[var(--vex-accent)] group-focus-visible:bg-[var(--vex-accent)]",
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase leading-none tracking-[0.18em]",
                      launching
                        ? "text-[var(--vex-accent-text)]"
                        : "text-[var(--vex-accent-text)] group-hover:text-[var(--vex-accent-contrast)] group-focus-visible:text-[var(--vex-accent-contrast)]",
                    )}
                  >
                    {launching ? "Preparing contract…" : "Launch mission"}
                  </span>
                  <HugeiconsIcon
                    icon={PlayIcon}
                    size={13}
                    aria-hidden
                    className={cn(
                      launching
                        ? "animate-pulse text-[var(--vex-accent-text)]"
                        : "text-[var(--vex-accent-text)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--vex-accent-contrast)] group-focus-visible:text-[var(--vex-accent-contrast)]",
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {launchError !== null ? (
        <p
          role="alert"
          className="px-1 pt-1 text-xs leading-relaxed text-destructive"
        >
          {launchError}
        </p>
      ) : null}
    </div>
  );
}
