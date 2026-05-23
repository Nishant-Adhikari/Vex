/**
 * Slash command dispatcher (puzzle 04 phase 7).
 *
 * `useSlashCommandDispatch` wires the per-command mission mutation
 * hooks once at the top of the composer and routes a parsed
 * `SlashCommand` through an exhaustive switch. The hook intentionally
 * holds no state of its own — `pending` aggregates `isPending` from
 * every mutation, the confirmation dialog lives in the caller.
 *
 * Renderer-side preflight:
 *   - `mission-start` requires a current `missionId` (the draft / ready
 *     row from `useMissionDraft`). Missing → `blocked`.
 *   - `mission-renew` resolves `previousMissionId` via
 *     `queryClient.fetchQuery` against `mission.getRenewableSource`
 *     (cached if within staleTime). null data → `blocked` ("No
 *     completed mission to renew."). Codex phase 7 review #3.
 *   - `mission-edit` dispatches the still-fail-closed `updateDraft`
 *     and maps `outcome: "unavailable"` to a friendly "structured form
 *     coming soon" success notice — NOT an error. Codex phase 7
 *     /mission edit correction.
 *   - `restore` mints a fresh `crypto.randomUUID()` idempotency key on
 *     every dispatch attempt.
 *
 * Codex phase 7 final review #1: every command result runs through a
 * per-command outcome mapper (`dispatch-outcomes.ts`). Engine
 * refusals like `not_accepted`, `no_active_run`, `blocked_active_run`,
 * `no_checkpoint`, `not_terminal_yet` surface as `blocked` notices —
 * NOT a misleading "Mission dispatched" success.
 */

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { MissionGetRenewableSourceResult } from "@shared/schemas/mission.js";
import { missionKeys } from "../../../lib/api/queryKeys.js";
import {
  useMissionContinue,
  useMissionRecover,
  useMissionRenew,
  useMissionRestore,
  useMissionRewind,
  useMissionStart,
  useMissionStop,
  useUpdateMissionDraft,
} from "../../../lib/api/mission.js";
import {
  mapContinueOutcome,
  mapRecoverOutcome,
  mapRenewOutcome,
  mapRestoreOutcome,
  mapRewindOutcome,
  mapStartOutcome,
  mapStopOutcome,
} from "./dispatch-outcomes.js";
import type { DispatchOutcome, SlashCommand } from "./types.js";

const RENEWABLE_SOURCE_STALE_MS = 5_000;

export interface SlashDispatchContext {
  /** Current session id (the composer rejects slash dispatch when null). */
  readonly sessionId: string;
  /**
   * Current draft mission id from `useMissionDraft`. Required for
   * `/mission start`. `null` when no draft row exists yet.
   */
  readonly missionId: string | null;
}

export interface SlashDispatchApi {
  readonly dispatch: (command: SlashCommand) => Promise<DispatchOutcome>;
  /** True iff any underlying mutation is mid-flight. */
  readonly pending: boolean;
}

function fromResult<T>(
  result: Result<T>,
  mapOk: (data: T) => DispatchOutcome,
): DispatchOutcome {
  if (!result.ok) return { kind: "error", message: result.error.message };
  return mapOk(result.data);
}

export function useSlashCommandDispatch(
  ctx: SlashDispatchContext,
): SlashDispatchApi {
  const start = useMissionStart();
  const cont = useMissionContinue();
  const recover = useMissionRecover();
  const stop = useMissionStop();
  const rewind = useMissionRewind();
  const restore = useMissionRestore();
  const renew = useMissionRenew();
  const updateDraft = useUpdateMissionDraft();
  const queryClient = useQueryClient();

  const dispatch = useCallback(
    async (command: SlashCommand): Promise<DispatchOutcome> => {
      switch (command.kind) {
        case "mission-start": {
          if (ctx.missionId === null) {
            return {
              kind: "blocked",
              message:
                "No mission draft for this session. Start chatting with Vex to outline one first.",
            };
          }
          const result = await start.mutateAsync({
            sessionId: ctx.sessionId,
            missionId: ctx.missionId,
          });
          return fromResult(result, mapStartOutcome);
        }
        case "mission-continue":
        case "retry": {
          const result = await cont.mutateAsync({ sessionId: ctx.sessionId });
          return fromResult(result, mapContinueOutcome);
        }
        case "mission-recover": {
          const result = await recover.mutateAsync({ sessionId: ctx.sessionId });
          return fromResult(result, mapRecoverOutcome);
        }
        case "mission-stop": {
          const result = await stop.mutateAsync({ sessionId: ctx.sessionId });
          return fromResult(result, mapStopOutcome);
        }
        case "rewind": {
          const result = await rewind.mutateAsync({
            sessionId: ctx.sessionId,
            turns: command.turns,
          });
          return fromResult(result, (data) =>
            mapRewindOutcome(data, command.turns),
          );
        }
        case "restore": {
          const idempotencyKey = globalThis.crypto.randomUUID();
          const result = await restore.mutateAsync({
            sessionId: ctx.sessionId,
            idempotencyKey,
          });
          return fromResult(result, mapRestoreOutcome);
        }
        case "mission-renew": {
          let renewable: Result<MissionGetRenewableSourceResult>;
          try {
            renewable = await queryClient.fetchQuery({
              queryKey: missionKeys.renewableSource(ctx.sessionId),
              queryFn: () =>
                window.vex.mission.getRenewableSource({
                  sessionId: ctx.sessionId,
                }),
              staleTime: RENEWABLE_SOURCE_STALE_MS,
            });
          } catch (cause) {
            return {
              kind: "error",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Unable to resolve renewable mission source.",
            };
          }
          if (!renewable.ok) {
            return { kind: "error", message: renewable.error.message };
          }
          if (renewable.data === null) {
            return {
              kind: "blocked",
              message:
                "No completed mission to renew. Start and finish a mission first.",
            };
          }
          const result = await renew.mutateAsync({
            sessionId: ctx.sessionId,
            previousMissionId: renewable.data.missionId,
          });
          return fromResult(result, mapRenewOutcome);
        }
        case "mission-edit": {
          const result = await updateDraft.mutateAsync({
            sessionId: ctx.sessionId,
          });
          if (!result.ok) {
            return { kind: "error", message: result.error.message };
          }
          // Phase 6 leaves updateDraft fail-closed → outcome=unavailable.
          // Surface as a friendly success, NOT an error (codex phase 7
          // /mission edit correction). When the structured form ships,
          // the outcome enum gains real success branches and this
          // mapper switches to mapEditOutcome.
          if (result.data.outcome === "unavailable") {
            return {
              kind: "success",
              message:
                "Structured form coming soon — for now, tell Vex what to change.",
            };
          }
          return { kind: "success", message: "Draft update requested." };
        }
      }
    },
    [
      ctx.missionId,
      ctx.sessionId,
      queryClient,
      start,
      cont,
      recover,
      stop,
      rewind,
      restore,
      renew,
      updateDraft,
    ],
  );

  const pending = useMemo<boolean>(
    () =>
      start.isPending ||
      cont.isPending ||
      recover.isPending ||
      stop.isPending ||
      rewind.isPending ||
      restore.isPending ||
      renew.isPending ||
      updateDraft.isPending,
    [
      start.isPending,
      cont.isPending,
      recover.isPending,
      stop.isPending,
      rewind.isPending,
      restore.isPending,
      renew.isPending,
      updateDraft.isPending,
    ],
  );

  return { dispatch, pending };
}
