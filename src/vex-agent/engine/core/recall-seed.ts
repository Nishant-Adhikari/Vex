/**
 * Recall seed — the string used to drive semantic recall queries every turn
 * (`memory_recall` invocations / future seed-based prefetch).
 *
 * Historic behaviour was "use the last user input". For mission / full-
 * autonomous runs that breaks after compaction (there may be no recent user
 * input — the engine loops on its own), and for wake resume the last user
 * input predates the wait entirely. The resolver uses 5 priorities:
 *
 *   1. Active checkpoint handoff — legacy path; the PR2 cutover removed the
 *      writer (`checkpoint_handoff_prepare`), so this branch is effectively
 *      unreachable in new sessions but is kept defensively until PR4 drops
 *      the table outright.
 *   2. Post-wake — a wake_due banner just landed, so the handoff reason +
 *      mission objective + open loops are the relevant seed.
 *   3. Mission / full-autonomous with history — last meaningful assistant
 *      plan + open loops + tool summary.
 *   4. Empty full-autonomous — first turn of a fresh full-autonomous run;
 *      there is no user input to fall back to. Use recent session-memory
 *      themes, or return `null` to skip the recall block entirely.
 *   5. Chat / fallback — last user input (the pre-PR-10 behaviour).
 *
 * The resolver is intentionally small and pure so it is easy to test in
 * isolation. The turn-time wiring in `turn.ts` composes the inputs (last
 * engine message, open loops, handoff, recent themes).
 */

import type { CheckpointHandoff } from "@vex-agent/db/repos/checkpoint-handoffs.js";
import type { Message } from "@vex-agent/db/repos/messages.js";

export interface EffectiveRecallSeedInput {
  sessionKind: "agent" | "mission";
  missionRunActive: boolean;
  messages: readonly Message[];
  missionObjective?: string | null;
  activeHandoff?: CheckpointHandoff | null;
  lastEngineMessage?: LastEngineMessageHint | null;
  openLoops?: readonly string[];
  /**
   * Recent narrative-memory themes (slugs) for this session. Sourced from
   * `session_memories` via `getSessionMemoryStats.recentThemes`. Replaces
   * the legacy `recentEpisodeTitles` source after PR2 cutover.
   */
  recentThemes?: readonly string[];
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
 * Resolve the recall seed. PR2-cutover note: the only production caller
 * (`fetchSessionEpisodeRecallBlock`) was deleted with the legacy auto-
 * recall pipeline; this function survives as a pure utility for future
 * consumers (PR3 telemetry / PR4 eval-harness seeds). Returns `null` to
 * skip the recall block entirely — happens for fresh autonomous sessions
 * with zero history and no hint sources.
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

  // 3. Mission run with session history — pull the last meaningful assistant
  //    content (a plan / continuation note), plus any open loops the caller
  //    threaded through. Agent mode is one-shot; this branch never fires
  //    there because there's no recurring recall surface.
  if (input.sessionKind === "mission" && input.missionRunActive) {
    const assistantHint = findLastSubstantialAssistantContent(input.messages);
    if (assistantHint) {
      const parts: string[] = [assistantHint];
      if (input.openLoops && input.openLoops.length > 0) parts.push(input.openLoops.join(" "));
      return parts.join(" ").trim();
    }
  }

  // 4. Mission with no live messages — fall back to recent narrative-memory
  //    themes so a fresh run wakes into a recall pool seeded by prior work.
  //    Themes are slugs (e.g. `kyber_quote_timeout_pattern`); rendering them
  //    as a natural-language seed is the chunker's job at write time, so we
  //    pass them straight through.
  if (input.sessionKind === "mission") {
    const themes = (input.recentThemes ?? []).filter((t) => t.trim().length > 0);
    if (themes.length > 0) {
      return `${EMPTY_OBJECTIVE_FALLBACK}: ${themes.slice(0, 3).join(" / ")}`;
    }
    // No themes either → explicitly skip the recall block instead of
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
