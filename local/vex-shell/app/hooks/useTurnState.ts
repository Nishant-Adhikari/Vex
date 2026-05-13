/**
 * Live turn polling — 500 ms tick while a user turn or mission is active.
 *
 * Side-channel: the engine's `routeUserMessage` returns as a single Promise
 * with the final text. We poll `messagesRepo.getLiveMessages` in parallel to
 * surface intermediate tool-calls + tool-results as they land in the DB, so
 * the UI can show `[tool:NAME]` badges in the chat AND populate the Ctrl+O
 * history panel with the full args + result for each call.
 *
 * The chat stream stays compact (`[tool:NAME]` only — no inline params or
 * results). Full data lives in the `recentToolCalls` ring-buffer on the
 * store, browsable via Ctrl+O.
 */

import { useEffect, useRef } from "react";
import * as messagesRepo from "../../../../src/vex-agent/db/repos/messages.js";
import * as toolOutputBlobsRepo from "../../../../src/vex-agent/db/repos/tool-output-blobs.js";
import { createChildLogger } from "../../../../src/utils/logger.js";
import {
  type MissionRunStatus,
  ACTIVE_OR_PAUSED_RUN_STATUSES,
} from "../../../../src/vex-agent/engine/types.js";
import type { PendingTurn, Store, ToolCallEntry } from "../state/store.js";
import { useStore, appendToolCall, completeToolCall } from "../state/store.js";
import { formatMissionDraftUpdateSummary, makeLine } from "../lib/shellMessages.js";

const POLL_INTERVAL_MS = 500;
const log = createChildLogger({ component: "vex-shell", stage: "live-polling" });

export function isMissionActivityStatus(status: string | null | undefined): boolean {
  return (
    typeof status === "string" &&
    ACTIVE_OR_PAUSED_RUN_STATUSES.has(status as MissionRunStatus)
  );
}

export function shouldPollTurnState(
  pendingTurn: PendingTurn | null,
  missionStatus: string | null | undefined,
): boolean {
  return pendingTurn !== null || isMissionActivityStatus(missionStatus);
}

export function useTurnState(store: Store): void {
  const shouldPoll = useStore(
    store,
    (s) => shouldPollTurnState(
      s.pendingTurn,
      s.session?.missionStatus ?? null,
    ),
  );
  const sessionId = useStore(store, (s) => s.session?.id ?? null);
  const lastSeenMessageIdRef = useRef<number>(0);
  const errorLoggedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!shouldPoll || !sessionId) return;

    // Each active turn/mission span is its own polling window. Pin
    // `turnStartedAt` so rows created BEFORE activation are treated as
    // history, and rows created at-or-after are streamed into chat +
    // recentToolCalls.
    // Earlier seeding by `max(rows.id)` had a race: fast tools (< 500 ms)
    // landed all their rows before the first tick ran, then got tagged as
    // history and never appeared in either the chat or the Ctrl+O panel.
    const turnStartedAt = store.getState().pendingTurn?.startedAt ?? Date.now();
    lastSeenMessageIdRef.current = 0;
    errorLoggedRef.current = false;

    const tick = async (): Promise<void> => {
      try {
        const rows = await messagesRepo.getLiveMessages(sessionId);

        for (const row of rows) {
          if (row.id == null) continue;
          if (row.id <= lastSeenMessageIdRef.current) continue;
          // Skip rows older than the turn start — they belong to history.
          const rowMs = new Date(row.timestamp).getTime();
          if (Number.isFinite(rowMs) && rowMs < turnStartedAt) {
            // Advance the cursor so we don't re-evaluate the same row each tick.
            lastSeenMessageIdRef.current = row.id;
            continue;
          }
          lastSeenMessageIdRef.current = row.id;

          const currentlyPending = store.getState().pendingTurn !== null;

          if (row.role === "assistant") {
            if (!currentlyPending && row.content.trim()) {
              store.setState((s) => ({
                messages: [
                  ...s.messages,
                  {
                    id: `assistant-${row.id}`,
                    role: "assistant",
                    content: row.content,
                    timestamp: row.timestamp,
                  },
                ],
              }));
              store.getState().reporter?.recordEvent({
                kind: "assistantMessage",
                text: row.content,
                stopReason: null,
                missionStatus: store.getState().session?.missionStatus ?? null,
              });
            }

            if (!row.toolCalls || row.toolCalls.length === 0) continue;

            for (const call of row.toolCalls) {
              const entry: ToolCallEntry = {
                id: `entry-${row.id}-${call.id}`,
                toolName: call.command,
                toolCallId: call.id,
                args: call.args ?? {},
                result: null,
                status: "pending",
                startedAt: row.timestamp,
                endedAt: null,
              };
              store.setState((s) => ({
                pendingTurn: s.pendingTurn
                  ? { ...s.pendingTurn, currentToolName: call.command, currentToolCallId: call.id }
                  : null,
                messages: [
                  ...s.messages,
                  {
                    id: `call-${row.id}-${call.id}`,
                    role: "tool",
                    toolName: call.command,
                    toolCallId: call.id,
                    // Empty content — Messages.tsx renders tool entries as
                    // label-only (the `[tool:NAME]` badge is the role label
                    // itself). Defense-in-depth: even if `makeMessageBlock`
                    // ever forgets to special-case tool, an empty content
                    // row collapses to a blank line instead of duplicating
                    // the label.
                    content: "",
                    timestamp: row.timestamp,
                  },
                ],
                ...appendToolCall(s, entry),
              }));
              store.getState().reporter?.recordEvent({
                kind: "toolCall",
                toolCallId: call.id,
                toolName: call.command,
                args: call.args ?? {},
                redacted: false,
                sourceRowId: row.id,
              });
            }
          } else if (row.role === "tool") {
            // Status — primary signal: explicit `success` from engine metadata
            // (`messages.metadata.payload.success`, written by
            // turn-loop.ts:persistToolResultWithOverflow + resume.ts). Legacy
            // fallback: regex on content for sessions persisted before that
            // field landed (replay, archived runs).
            const payload = row.metadata?.payload as
              | { success?: boolean; overflow?: boolean; blobKey?: string }
              | undefined;
            const explicitSuccess = payload?.success;
            const looksFailed =
              typeof row.content === "string"
              && /^(Tool .* failed|Error:|.*: error)/i.test(row.content);
            const status: "done" | "failed" =
              explicitSuccess === false ? "failed"
                : explicitSuccess === true ? "done"
                  : looksFailed ? "failed"
                    : "done";

            // Result — when the engine externalised a long output to the blob
            // store (>16 KiB), `row.content` is a stub like
            // `[tool_output_overflow blob_key=... ...]`. Fetch the full
            // payload so the Ctrl+O panel shows the actual result, not the
            // stub. Falls back to the stub if the blob expired (15 min TTL)
            // or the read fails.
            let result =
              typeof row.content === "string" ? row.content : JSON.stringify(row.content);
            if (payload?.overflow && typeof payload.blobKey === "string") {
              try {
                const blob = await toolOutputBlobsRepo.readBlob(payload.blobKey);
                if (blob?.payload?.fullOutput) {
                  result = blob.payload.fullOutput;
                }
              } catch (err) {
                if (!errorLoggedRef.current) {
                  log.warn("vex-shell.live_polling.blob_fetch_failed", {
                    blobKey: payload.blobKey,
                    error: err instanceof Error ? err.message : String(err),
                  });
                  errorLoggedRef.current = true;
                }
              }
            }

            if (row.toolCallId) {
              const toolCallId = row.toolCallId;
              let resolvedToolName: string | null = null;
              let startedAtIso: string | null = null;
              store.setState((s) => {
                const matched = s.recentToolCalls.find(
                  (entry) => entry.toolCallId === toolCallId,
                );
                if (matched) {
                  resolvedToolName = matched.toolName;
                  startedAtIso = matched.startedAt;
                }
                const completion = completeToolCall(s, toolCallId, result, status, row.timestamp);
                // Clear the spinner label only when THIS call's result lands.
                // Avoids the divergence where panel shows 5/5 done but the
                // bottom bar still says "Calling tool: web_research". Multiple
                // in-flight calls keep the latest one shown until each clears.
                if (s.pendingTurn?.currentToolCallId === toolCallId) {
                  return {
                    ...completion,
                    pendingTurn: { startedAt: s.pendingTurn.startedAt },
                  };
                }
                return completion;
              });

              // Capture the fully-resolved tool result (blob already fetched
              // above when overflow). This is the only crash-safe window —
              // the blob TTL is short and a postmortem read can fail.
              const completedAtMs = new Date(row.timestamp).getTime();
              const startedAtMs = startedAtIso ? new Date(startedAtIso).getTime() : NaN;
              const durationMs =
                Number.isFinite(completedAtMs) && Number.isFinite(startedAtMs)
                  ? Math.max(0, completedAtMs - startedAtMs)
                  : null;
              store.getState().reporter?.recordEvent({
                kind: "toolResult",
                toolCallId,
                toolName: resolvedToolName ?? "unknown",
                success: status === "done",
                status,
                output: result,
                byteSize: Buffer.byteLength(result, "utf8"),
                fromBlob: !!payload?.overflow,
                blobKey: payload?.blobKey,
                completedAt: row.timestamp,
                durationMs,
                redacted: false,
              });

              if (resolvedToolName === "mission_draft_update") {
                const summary = formatMissionDraftUpdateSummary(result);
                if (summary) {
                  store.setState((s) => ({
                    messages: [...s.messages, makeLine("system", summary)],
                  }));
                }
              }
            }
          }
        }
      } catch (err) {
        // Throttled — once per pending turn. Silent catches were violating
        // rule 00.8 / 10.8 (no empty catches, observable failures); spamming
        // every tick on a sustained DB outage is also not useful.
        if (!errorLoggedRef.current) {
          log.warn("vex-shell.live_polling.failed", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
          errorLoggedRef.current = true;
        }
      }
    };

    const handle = setInterval(tick, POLL_INTERVAL_MS);
    void tick();

    return () => {
      clearInterval(handle);
    };
  }, [shouldPoll, sessionId, store]);
}
