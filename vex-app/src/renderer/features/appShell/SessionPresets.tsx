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
import { Target02Icon } from "@hugeicons/core-free-icons";
import type { SessionCreateInput } from "@shared/schemas/sessions.js";
import { cn } from "../../lib/utils.js";
import { useCreateSession } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { MISSION_PRESETS, type MissionPreset } from "./missionPresets.js";

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
    <div className="flex flex-col gap-2 px-1" data-vex-area="session-presets">
      <p className="px-1 pb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--vex-text-3)]">
        One-click missions
      </p>
      <ul className="flex flex-col gap-2">
        {MISSION_PRESETS.map((preset) => {
          const launching = launchingId === preset.id;
          return (
            <li key={preset.id}>
              <button
                type="button"
                disabled={launchingId !== null}
                onClick={() => {
                  void handleLaunch(preset);
                }}
                data-preset-id={preset.id}
                aria-label={`Launch preset: ${preset.title}`}
                className={cn(
                  // Numbered trust-zone card grammar (mirrors RadioCard): a
                  // hairline surface that fills faintly on hover, accent ring
                  // on keyboard focus.
                  "group relative flex w-full flex-col gap-1.5 rounded-lg border border-[var(--vex-line)] px-4 py-3.5 text-left transition-colors",
                  "hover:bg-white/[0.03]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <span className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={Target02Icon}
                    size={14}
                    className="text-[var(--vex-accent-text)]"
                    aria-hidden
                  />
                  <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[var(--vex-text)]">
                    {preset.title}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-[var(--vex-text-3)]">
                  {preset.description}
                </span>
                {launching ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-accent-text)]">
                    Preparing contract…
                  </span>
                ) : null}
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
