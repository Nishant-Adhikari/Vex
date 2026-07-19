/**
 * Hypervexing workspace controller. Bridges agent-driven workspace-mode pushes
 * to the transient `workspaceMode` UI flag, gating first entry on the risk
 * acknowledgment.
 *
 * Ownership split:
 *  - the AGENT decides entry/exit (a main→renderer push, `subscribeWorkspaceMode`);
 *  - the STORE holds the transient flag (`workspaceMode`, never persisted);
 *  - THIS hook holds only the ack-dialog gate state, and turns a decoded action
 *    (`resolveWorkspaceModeEvent`) into the right store/dialog transition.
 *
 * Exit is always available in-mode. Main remains the authority: `exit()` asks
 * main to change the active session and waits for its pushed `normal` event.
 *
 * `visualWorkspaceMode` is the shell's VISUAL authority, distinct from the
 * store's logical `workspaceMode`: entering mirrors it on the next effect
 * tick (one commit — imperceptible), but on exit it LAGS at "hypervexing"
 * until the shell reports the drain animation finished
 * (`onExitAnimationComplete`, wired to `AnimatePresence`'s `onExitComplete`).
 * Without this lag the shell's hard render conditional unmounts the trading
 * room — and flips its theme back — before the room's own declared exit
 * animation ever gets to play (the #40 defect). The lag applies uniformly
 * regardless of `prefers-reduced-motion`: that preference already shortens
 * the drain itself (`workspaceTransition.ts`), so waiting for its completion
 * reads as an instant swap. The normal shell never double-mounts alongside a
 * still-present room on EITHER edge: the shell hides it on
 * `workspaceMode === "hypervexing" || visualWorkspaceMode === "hypervexing"`
 * (`AppShell.tsx`), so the one-tick entry lag on the visual flag is covered
 * by the always-instant logical one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useUiStore } from "../../../stores/uiStore.js";
import {
  useAcknowledgeHyperliquidRisk,
  useHyperliquidWorkspaceModeRead,
} from "../../../lib/api/hyperliquid.js";
import type { WorkspaceMode } from "../../../stores/uiStore.js";
import { resolveWorkspaceModeEvent, type WorkspaceModeAction } from "./workspaceModeGate.js";
import {
  requestWorkspaceExit,
  subscribeWorkspaceMode,
} from "./workspaceBridge.js";

export interface HypervexingWorkspaceController {
  /** Logical mode (the store's transient flag) — gates whether the trading
   * room is the child AnimatePresence is asked to keep present/exit. */
  readonly workspaceMode: WorkspaceMode;
  /** Visual mode — lags `workspaceMode` on exit until the drain animation
   * completes. Gates theme, sky dimming, and the normal shell's mount so it
   * never doubles up with the still-draining room. */
  readonly visualWorkspaceMode: WorkspaceMode;
  /** The first-entry risk dialog is open (agent asked to enter, not yet acked). */
  readonly ackPending: boolean;
  /** The acknowledgment write is in flight. */
  readonly ackSaving: boolean;
  /** Accept the risk: persist the ack, then activate the mode. */
  readonly confirmAck: () => void;
  /** Decline first entry: close the dialog and stay in normal mode. */
  readonly cancelAck: () => void;
  /** In-mode EXIT: leave the mode (local flip + tell main). */
  readonly exit: () => Promise<boolean>;
  /** Call once the shell's `AnimatePresence` reports the exit drain finished
   * (its `onExitComplete`) — releases `visualWorkspaceMode` back to normal. */
  readonly onExitAnimationComplete: () => void;
}

export function useHypervexingWorkspace(): HypervexingWorkspaceController {
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const [ackPending, setAckPending] = useState(false);
  const acknowledge = useAcknowledgeHyperliquidRisk();
  const modeRead = useHyperliquidWorkspaceModeRead(activeSessionId);

  // Visual mode: mirrors `workspaceMode` on enter (one effect tick); on exit
  // it holds "hypervexing" until `onExitAnimationComplete` releases it (see
  // the file docblock for why the lag exists, why it stays uniform across
  // `prefers-reduced-motion`, and why the shell's OR-gate keeps either edge
  // double-mount-safe).
  const [visualWorkspaceMode, setVisualWorkspaceMode] =
    useState<WorkspaceMode>(workspaceMode);

  useEffect(() => {
    if (workspaceMode === "hypervexing") setVisualWorkspaceMode("hypervexing");
  }, [workspaceMode]);

  const onExitAnimationComplete = useCallback((): void => {
    setVisualWorkspaceMode("normal");
  }, []);

  const applyAction = useCallback(
    (action: WorkspaceModeAction): void => {
      if (action.type === "enter") {
        setAckPending(false);
        setWorkspaceMode("hypervexing");
      } else if (action.type === "acknowledge") {
        // Gate before the morph: the dialog renders in the CURRENT theme, and
        // the mode activates only once the user accepts (confirmAck below).
        setAckPending(true);
      } else {
        setAckPending(false);
        setWorkspaceMode("normal");
      }
    },
    [setWorkspaceMode],
  );

  // A mount-read may resolve AFTER a live push for the same session; the push
  // is the fresher authority, so reconciliation applies AT MOST ONCE per
  // session and a push claims the session before a late read can override it.
  const reconciledSessionId = useRef<string | null>(null);

  useEffect(() => {
    return subscribeWorkspaceMode((event) => {
      // The mode is per-session in main's map: a background session's agent
      // (e.g. a mission) must not morph the UI the user is looking at.
      if (event.sessionId !== activeSessionId) return;
      reconciledSessionId.current = activeSessionId;
      applyAction(resolveWorkspaceModeEvent(event));
    });
  }, [applyAction, activeSessionId]);

  // Session-switch reconciliation: pushes only cover live transitions, so a
  // switch to a session already in `hypervexing` (or back to a normal one)
  // re-reads main's authoritative per-session mode and converges the UI flag.
  useEffect(() => {
    if (activeSessionId === null) {
      reconciledSessionId.current = null;
      setAckPending(false);
      setWorkspaceMode("normal");
      return;
    }
    if (reconciledSessionId.current === activeSessionId) return;
    if (modeRead.data?.ok !== true) return;
    reconciledSessionId.current = activeSessionId;
    applyAction(resolveWorkspaceModeEvent(modeRead.data.data));
  }, [activeSessionId, applyAction, modeRead.data, setWorkspaceMode]);

  const confirmAck = useCallback(() => {
    acknowledge.mutate(undefined, {
      onSuccess: (result) => {
        if (!result.ok) return;
        setAckPending(false);
        setWorkspaceMode("hypervexing");
      },
    });
  }, [acknowledge, setWorkspaceMode]);

  const cancelAck = useCallback(() => {
    setAckPending(false);
    void requestWorkspaceExit(activeSessionId);
  }, [activeSessionId]);

  // Main is the sole authority: the mode changes only when its `normal` push
  // arrives. A failed invoke leaves the workspace intact for a visible retry.
  const exit = useCallback(() => requestWorkspaceExit(activeSessionId), [activeSessionId]);

  return {
    workspaceMode,
    visualWorkspaceMode,
    ackPending,
    ackSaving: acknowledge.isPending,
    confirmAck,
    cancelAck,
    exit,
    onExitAnimationComplete,
  };
}
