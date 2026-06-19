/**
 * MissionContractModal — the mission contract review/accept surface, hosted in
 * a top-layer native `<dialog>` (the MISSION RAIL's `PremiumBadge` opens it).
 *
 * This wraps the SAME state machine + hooks the inline `MissionContractCard`
 * uses (`useMissionDraft` + `useMissionDiff` + `useSessionPlan` →
 * `resolvePlanGate`, `useAcceptMissionContract`, `useSetAutoRetry`). The single
 * "Accept contract & plan" action lives in the DialogFooter — `shrink-0` and
 * pinned, so it can never be pushed below the fold the way the inline card's
 * footer was (that overflow is the bug this rail/modal redesign resolves).
 *
 * The body reuses the card's presentational `CardBody` + `AutoRetrySection`;
 * the footer reproduces the `CardFooter` accept logic (helper copy, plan-mode
 * gate, plan_missing block, accept-outcome notice) in the dialog's footer
 * surface.
 *
 * `planUpdatedAt` token wiring is preserved EXACTLY: the renderer reads the
 * reviewed plan's `updatedAt` via `plan.get` and echoes it back to
 * `mission.acceptContract` as the stale guard ONLY when an enabled, non-empty,
 * unaccepted plan exists. No plan CONTENT crosses any new boundary — the
 * markdown is already returned by `plan.get`; the modal only echoes the
 * timestamp. On a `plan_stale` outcome the modal shows an in-modal banner and
 * refetches the plan (the accept mutation does not invalidate it), then leaves
 * the Accept button in place for re-review.
 */

import { useEffect, useMemo } from "react";
import type { JSX } from "react";
import { assertNever, type Result } from "@shared/ipc/result.js";
import type {
  MissionAcceptContractResult,
  MissionDraftDto,
  MissionGetDiffResult,
} from "@shared/schemas/mission.js";
import type { PlanGetResult } from "@shared/schemas/session-plan.js";
import {
  useAcceptMissionContract,
  useMissionDiff,
  useMissionDraft,
  useSetAutoRetry,
} from "../../lib/api/mission.js";
import { useSessionPlan } from "../../lib/api/sessions.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import {
  AutoRetrySection,
  CardBody,
  type CardStateKind,
} from "./MissionContractCardSections.js";
import { PremiumBadge, type PremiumBadgeState } from "./PremiumBadge.js";

/**
 * Plan-mode gate for the unified accept step (Approach A). Mirrors the engine's
 * `enabled && !accepted` condition — identical to `MissionContractCard` so the
 * inline card and the modal derive the same gate from the same query.
 */
type PlanGate =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly planUpdatedAt: string }
  | { readonly kind: "missing" };

function resolvePlanGate(plan: PlanGetResult | null): PlanGate {
  if (plan === null || !plan.enabled || plan.accepted) return { kind: "none" };
  if (plan.planMd.length === 0) return { kind: "missing" };
  return { kind: "ready", planUpdatedAt: plan.updatedAt };
}

interface CardState {
  readonly kind: CardStateKind;
  readonly draft: MissionDraftDto;
  readonly currentHash: string | null;
}

export interface MissionContractModalProps {
  readonly sessionId: string;
  readonly permission: "full" | "restricted";
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

export function MissionContractModal({
  sessionId,
  permission,
  open,
  onOpenChange,
}: MissionContractModalProps): JSX.Element {
  const draftQuery = useMissionDraft(sessionId);
  const draft = readDraft(draftQuery.data);
  const diffQuery = useMissionDiff(sessionId, draft?.missionId ?? null);
  const diff = readDiff(diffQuery.data);
  const planQuery = useSessionPlan(sessionId);
  const planGate = resolvePlanGate(readPlan(planQuery.data));
  const accept = useAcceptMissionContract();
  const autoRetry = useSetAutoRetry();

  const state = useMemo<CardState | null>(() => {
    if (draft === null) return null;
    if (draft.status === "draft") {
      return { kind: "setup-needed", draft, currentHash: null };
    }
    if (diff === null) {
      return { kind: "setup-needed", draft, currentHash: null };
    }
    if (diff.isAccepted && !diff.isDirty) {
      return { kind: "accepted", draft, currentHash: null };
    }
    if (diff.isAccepted && diff.isDirty) {
      return { kind: "dirty-acceptance", draft, currentHash: diff.currentHash };
    }
    return { kind: "awaiting-acceptance", draft, currentHash: diff.currentHash };
  }, [draft, diff]);

  const onAccept = (hash: string): void => {
    accept.mutate({
      sessionId,
      missionId: draft?.missionId ?? "",
      contractHash: hash,
      // Unified accept (Approach A): echo the reviewed plan's `updatedAt` as a
      // stale guard ONLY when an enabled, non-empty, unaccepted plan exists.
      // Plan-mode off / no plan → omitted → default single-accept payload.
      ...(planGate.kind === "ready"
        ? { planUpdatedAt: planGate.planUpdatedAt }
        : {}),
    });
  };

  const acceptOutcome = readAcceptOutcome(accept.data);
  // A rejected mutation (`isError`, no `data`) OR a resolved-but-failed Result
  // envelope (`ok: false`, a handled IPC/domain error) are both failure
  // surfaces — neither yields an `outcome`, so without this the user would see
  // nothing.
  const acceptErrored =
    accept.isError || (accept.data !== undefined && !accept.data.ok);
  const acceptNotice = acceptNoticeFor(acceptOutcome, acceptErrored);

  // plan_stale recovery: the accept mutation does NOT invalidate the plan
  // query, so refetch it here and keep the modal open with the Accept button
  // in place (in-modal banner via `acceptNotice` flags the re-review).
  //
  // Effect-driven (NOT render-phase): keyed on `accept.data` — TanStack hands
  // back a fresh result object on every settle, so this fires exactly ONCE per
  // accept attempt that resolves to `plan_stale`, never on subsequent re-renders
  // (the previous render-phase `refetch()` looped: each completed refetch
  // re-rendered while `acceptOutcome` was still `plan_stale`, re-triggering it).
  const planRefetch = planQuery.refetch;
  useEffect(() => {
    if (acceptOutcome === "plan_stale") {
      void planRefetch();
    }
    // `accept.data` is intentionally the trigger (new identity per settle); the
    // derived `acceptOutcome` would not change identity across a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accept.data, planRefetch]);

  const title = state?.draft.title?.trim() || "Mission contract";
  const badgeState = toBadgeState(state?.kind, acceptOutcome);
  const badgeShimmer = badgeState === "ready";

  const showAutoRetry = permission === "full" && state !== null;
  const autoRetryEnabled = state?.draft.constraints.autoRetryEnabled === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Shell dialog chrome: solid surface + hairline + the sanctioned
       * backdrop-blur-none override that beats the dialog base's blur-sm
       * (THE PROTOCOL DESK never uses glass — see shell-design-guard). */}
      <DialogContent
        data-vex-area="mission-contract-modal"
        className="max-w-lg rounded-xl border-[var(--vex-line-strong)] bg-[var(--vex-surface-2)] text-foreground shadow-none backdrop:bg-black/70 backdrop:backdrop-blur-none"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          {/* Status marker only — the modal is already open, so this is a
           * non-interactive `<span>` (no dead focus target), not the rail's
           * clickable badge. */}
          <span data-vex-state={badgeState} className="shrink-0">
            <PremiumBadge
              label="Mission"
              state={badgeState}
              shimmer={badgeShimmer}
              interactive={false}
            />
          </span>
        </DialogHeader>

        <DialogBody>
          {state === null ? (
            <p className="text-sm text-[var(--vex-text-3)]">
              Loading the mission contract…
            </p>
          ) : (
            <>
              <div className="-mx-6 -my-5">
                <CardBody draft={state.draft} />
                {showAutoRetry ? (
                  <AutoRetrySection
                    enabled={autoRetryEnabled}
                    pending={autoRetry.isPending}
                    onToggle={(next) =>
                      autoRetry.mutate({
                        sessionId,
                        missionId: state.draft.missionId,
                        enabled: next,
                      })
                    }
                  />
                ) : null}
              </div>
            </>
          )}
        </DialogBody>

        <FooterAction
          state={state}
          pending={accept.isPending}
          onAccept={onAccept}
          planGate={planGate}
          notice={acceptNotice}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FooterActionProps {
  readonly state: CardState | null;
  readonly pending: boolean;
  readonly onAccept: (hash: string) => void;
  readonly planGate: PlanGate;
  readonly notice: string | null;
}

/**
 * Reproduces `CardFooter`'s accept logic (helper copy, plan-mode label, the
 * plan_missing block, the accept notice) inside the dialog's pinned footer.
 * Kept here rather than reusing `CardFooter` so the action sits on the
 * DialogFooter surface (shrink-0, sticky) — the whole point of the move.
 */
function FooterAction({
  state,
  pending,
  onAccept,
  planGate,
  notice,
}: FooterActionProps): JSX.Element | null {
  if (state === null) return null;
  const { kind, currentHash } = state;

  if (kind === "setup-needed") {
    return (
      <DialogFooter className="justify-start text-xs text-[var(--vex-text-3)]">
        Add a goal, constraints, and stop conditions to enable Accept.
      </DialogFooter>
    );
  }
  if (kind === "accepted") {
    return (
      <DialogFooter className="justify-start text-xs text-[var(--vex-text-3)]">
        Use the{" "}
        <span className="text-[var(--vex-accent-text)]">Start mission</span>{" "}
        button to dispatch.
      </DialogFooter>
    );
  }
  if (currentHash === null) return null;

  // Plan-mode ON but nothing authored — block accept and prompt to write a plan
  // first (matches the engine `plan_missing`).
  if (planGate.kind === "missing") {
    return (
      <DialogFooter className="justify-start">
        <p
          className="text-xs text-warning"
          role="alert"
          data-vex-state="plan-missing"
        >
          Plan mode is on, but no action plan has been authored yet. Ask Vex to
          write the plan, then accept the contract and plan together.
        </p>
      </DialogFooter>
    );
  }

  const isDirty = kind === "dirty-acceptance";
  const unified = planGate.kind === "ready";
  const helperText = unified
    ? "Accepting locks the contract AND the action plan for this run."
    : isDirty
      ? "Re-accept to bring the runtime back in sync with the draft."
      : "Accepting locks the contract for this mission run.";
  const acceptLabel = pending
    ? "Accepting…"
    : unified
      ? "Accept contract & plan"
      : isDirty
        ? "Accept new contract"
        : "Accept contract";

  return (
    <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--vex-text-3)]">{helperText}</span>
        <Button
          type="button"
          onClick={() => onAccept(currentHash)}
          disabled={pending}
          data-vex-action="accept-contract"
          className="h-8 border border-[var(--vex-accent-border)] bg-transparent px-3 text-xs text-[var(--vex-accent-text)] hover:bg-[var(--vex-accent-fill-8)]"
        >
          {acceptLabel}
        </Button>
      </div>
      {notice !== null ? (
        <p
          role="alert"
          data-vex-state="plan-accept-notice"
          className="w-full text-xs text-warning"
        >
          {notice}
        </p>
      ) : null}
    </DialogFooter>
  );
}

/**
 * Map the contract state + accept outcome to the rail badge state. A transient
 * `plan_stale` outcome overrides to "stale" so the user sees the review-again
 * signal even though the underlying contract diff is still `awaiting`.
 */
function toBadgeState(
  kind: CardStateKind | undefined,
  acceptOutcome: MissionAcceptContractResult["outcome"] | null,
): PremiumBadgeState {
  if (acceptOutcome === "plan_stale") return "stale";
  switch (kind) {
    case undefined:
    case "setup-needed":
      return "preparing";
    case "accepted":
      return "accepted";
    case "dirty-acceptance":
      return "stale";
    case "awaiting-acceptance":
      return "ready";
  }
}

function readPlan(
  data: Result<PlanGetResult> | undefined,
): PlanGetResult | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readAcceptOutcome(
  data: Result<MissionAcceptContractResult> | undefined,
): MissionAcceptContractResult["outcome"] | null {
  if (!data || !data.ok) return null;
  return data.data.outcome;
}

/**
 * Map a `mission.acceptContract` attempt to a user-facing notice.
 *
 * Two failure surfaces feed this:
 *   - a resolved non-success `outcome` (handled IPC Result — the mutation
 *     "succeeded" at the transport level but the engine refused), and
 *   - a thrown/rejected mutation (`isError` — transport/IPC failure, where
 *     `accept.data` is absent).
 *
 * `plan_stale` / `plan_missing` keep their specific recovery copy; every other
 * non-success outcome maps to a generic "Couldn't accept: <reason>" so the user
 * never clicks Accept and sees nothing (the silent-failure bug). `accepted`
 * returns null (the diff query refetch reflects success).
 */
function acceptNoticeFor(
  outcome: MissionAcceptContractResult["outcome"] | null,
  isError: boolean,
): string | null {
  if (outcome !== null) return outcomeNotice(outcome);
  // No resolved outcome but the mutation rejected → transport/IPC failure.
  if (isError) {
    return "Couldn't accept the contract — something went wrong. Try again.";
  }
  return null;
}

function outcomeNotice(
  outcome: MissionAcceptContractResult["outcome"],
): string | null {
  switch (outcome) {
    case "accepted":
      return null;
    case "plan_stale":
      return "Plan changed — review again before accepting.";
    case "plan_missing":
      return "No plan authored yet — ask Vex to write a plan first.";
    case "mission_not_found":
      return "Couldn't accept: this mission no longer exists. Refresh and try again.";
    case "session_mismatch":
      return "Couldn't accept: this contract belongs to a different session.";
    case "hash_mismatch":
      return "Couldn't accept: the contract changed since you reviewed it. Review the current contract and accept again.";
    case "status_blocked":
      return "Couldn't accept: this mission can no longer be accepted in its current state.";
    case "run_active":
      return "Couldn't accept: a run is already active for this mission.";
    default:
      return assertNever(outcome);
  }
}

function readDraft(
  data: Result<MissionDraftDto | null> | undefined,
): MissionDraftDto | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readDiff(
  data: Result<MissionGetDiffResult> | undefined,
): Extract<MissionGetDiffResult, { outcome: "ready" }> | null {
  if (!data || !data.ok) return null;
  if (data.data.outcome !== "ready") return null;
  return data.data;
}
