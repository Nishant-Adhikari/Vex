/**
 * Recall seed — the string used to drive `session_episodes.recallTopK`
 * every turn.
 *
 * Historic behaviour was "use the last user input". For mission / full-
 * autonomous runs that breaks after compaction (there may be no recent user
 * input — the engine loops on its own), and for wake resume the last user
 * input predates the wait entirely. PR-10 introduces a 5-priority resolver:
 *
 *   1. Active checkpoint handoff — highest priority; writer either wrote
 *      a deliberate seed or PR-9 fell back to a deterministic DB-based one.
 *   2. Post-wake — a wake_due banner just landed, so the handoff reason +
 *      mission objective + open loops are the relevant seed.
 *   3. Mission / full-autonomous with history — last meaningful assistant
 *      plan + open loops + tool summary.
 *   4. Empty full-autonomous — first turn of a fresh full-autonomous run;
 *      there is no user input to fall back to. Use recent episode titles,
 *      or return `null` to skip the recall block entirely.
 *   5. Chat / fallback — last user input (the pre-PR-10 behaviour).
 *
 * The resolver is intentionally small and pure so it is easy to test in
 * isolation. The turn-time wiring in `turn.ts` composes the inputs (last
 * engine message, open loops, handoff).
 */

import type { CheckpointHandoff } from "@vex-agent/db/repos/checkpoint-handoffs.js";
import type { Message } from "@vex-agent/db/repos/messages.js";

export interface EffectiveRecallSeedInput {
  sessionKind: "chat" | "mission" | "full_autonomous";
  missionRunActive: boolean;
  messages: readonly Message[];
  missionObjective?: string | null;
  activeHandoff?: CheckpointHandoff | null;
  lastEngineMessage?: LastEngineMessageHint | null;
  openLoops?: readonly string[];
  recentEpisodeTitles?: readonly string[];
}

/**
 * Minimal view of the most recent engine message — turn.ts passes the
 * relevant fields so `effectiveRecallSeed` doesn't have to re-query them.
 * `messageType` is `wake_due` for banners injected by the wake executor
 * (PR-7 / PR-10). `reason` carries the model's own note (set via
 * `loop_defer.reason` and persisted in `messages.metadata.payload.reason`).
 */
export interface LastEngineMessageHint {
  messageType: string | null;
  reason: string | null;
}

const EMPTY_OBJECTIVE_FALLBACK = "Resume autonomous session";

/**
 * Resolve the seed for `session_episodes` recall. Returns `null` to let the
 * caller skip the recall block entirely — happens only for fresh full-
 * autonomous sessions with zero history and no hint sources.
 */
export function effectiveRecallSeed(input: EffectiveRecallSeedInput): string | null {
  // 1. Active handoff — PR-9 guarantees a non-empty preferredRecallQuery.
  if (input.activeHandoff) {
    const query = input.activeHandoff.payload.preferredRecallQuery.trim();
    if (query.length > 0) return query;
  }

  // 2. Post-wake signal — the last engine message is a wake_due banner. The
  //    reason field was the model's own hint; mission objective + open loops
  //    help anchor recall to the ongoing work.
  if (input.lastEngineMessage?.messageType === "wake_due") {
    const parts: string[] = [];
    const reason = input.lastEngineMessage.reason?.trim();
    if (reason) parts.push(reason);
    if (input.missionObjective) parts.push(input.missionObjective);
    if (input.openLoops && input.openLoops.length > 0) parts.push(input.openLoops.join(" "));
    const combined = parts.join(" ").trim();
    if (combined.length > 0) return combined;
  }

  // 3. Mission / full-autonomous with session history — pull the last
  //    meaningful assistant content (a plan / continuation note), plus any
  //    open loops the caller threaded through.
  if (input.sessionKind !== "chat" && (input.missionRunActive || input.sessionKind === "full_autonomous")) {
    const assistantHint = findLastSubstantialAssistantContent(input.messages);
    if (assistantHint) {
      const parts: string[] = [assistantHint];
      if (input.openLoops && input.openLoops.length > 0) parts.push(input.openLoops.join(" "));
      return parts.join(" ").trim();
    }
  }

  // 4. Empty full-autonomous — no history, but recent episode titles (if
  //    any) still point at what this session is supposed to be doing.
  if (input.sessionKind === "full_autonomous") {
    const titles = (input.recentEpisodeTitles ?? []).filter((t) => t.trim().length > 0);
    if (titles.length > 0) {
      return `${EMPTY_OBJECTIVE_FALLBACK}: ${titles.slice(0, 3).join(" / ")}`;
    }
    // No episodes either → explicitly skip the recall block instead of
    // falling back to an empty user input.
    return null;
  }

  // 5. Chat / fallback — last user input (legacy behaviour).
  return findLastUserInput(input.messages);
}

// ── Helpers ────────────────────────────────────────────────────────

const ASSISTANT_SEED_MAX = 500;

function findLastSubstantialAssistantContent(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const trimmed = (m.content ?? "").trim();
    if (trimmed.length === 0) continue;
    return trimmed.slice(0, ASSISTANT_SEED_MAX);
  }
  return null;
}

export function findLastUserInput(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && m.content.trim().length > 0) {
      return m.content;
    }
  }
  return null;
}
