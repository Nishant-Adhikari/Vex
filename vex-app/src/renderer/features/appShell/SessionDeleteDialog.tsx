/**
 * Confirmation dialog for the "Remove session" action.
 *
 * Uses the existing native `<dialog>` primitive so we get focus trap +
 * ESC + restore-focus for free. The default focus lands on Cancel
 * (UX skill §3 — destructive actions default to the least destructive
 * option).
 *
 * Outcome-aware: the description swaps to a blocked-state copy when
 * main refuses to remove the session because of an active mission run
 * or a pending approval. The user can resolve the blocker and click
 * Remove again — no error toast, no destructive fallback path.
 */

import type { JSX } from "react";
import type { SessionDeleteOutcome, SessionListItem } from "@shared/schemas/sessions.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { getSessionTitle } from "./sessionListModel.js";

interface SessionDeleteDialogProps {
  readonly session: SessionListItem | null;
  readonly blockedOutcome: SessionDeleteOutcome | null;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function SessionDeleteDialog({
  session,
  blockedOutcome,
  pending,
  onCancel,
  onConfirm,
}: SessionDeleteDialogProps): JSX.Element {
  const open = session !== null;
  const title = session === null ? "" : getSessionTitle(session);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-md border-white/[0.10] bg-[#071024]/92 text-foreground shadow-[0_0_80px_rgba(22,68,190,0.28)] backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        <DialogHeader className="border-white/[0.08]">
          <DialogTitle className="text-xl">Remove session?</DialogTitle>
          <DialogDescription className="text-[var(--color-text-secondary)]">
            {describeOutcome(title, blockedOutcome)}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-3" />

        <DialogFooter className="border-white/[0.08]">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
            autoFocus
            className="text-[var(--color-text-secondary)] hover:bg-white/[0.06] hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/85"
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeOutcome(
  title: string,
  outcome: SessionDeleteOutcome | null,
): string {
  if (outcome === "blocked_active_mission") {
    return `Can't remove "${title}" — this mission is still active. Stop the mission first, then try again.`;
  }
  if (outcome === "blocked_pending_approval") {
    return `Can't remove "${title}" — this session has a pending approval. Resolve it first, then try again.`;
  }
  if (outcome === "state_changed") {
    return "Session state changed since you opened this dialog. Try again.";
  }
  // Initial state — honest soft-delete copy.
  return `Remove "${title}" from your sidebar. Local message history stays on your disk; this only hides it from the app.`;
}
